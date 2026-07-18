// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcVerification.sol";
import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";
import {IReferencedPaymentNonexistence} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";

/// @notice Minimal FAssets surface used by the vault (redemption to an XRPL address).
interface IFAssetRedeemer {
    function redeemAmount(uint256 _amountUBA, string memory _redeemerUnderlyingAddressString, address payable _executor)
        external
        payable
        returns (uint256 _redeemedAmountUBA);

    function minimumRedeemAmountUBA() external view returns (uint256);
}

/// @title HeirloomVault — the continuity vault for XRP.
/// @notice One vault per continuity plan (deployed as an EIP-1167 clone).
///
/// Authorization model: the EVM side has no privileged keys. Every state change
/// is authorized by an XRPL event proven by Flare's FDC, or by public data:
///  - heartbeat / cancel: XRPPayment proofs (owner-signed XRPL payments)
///  - silence:            ReferencedPaymentNonexistence proofs, source-filtered
///  - claim / release:    permissionless cranks gated by proofs + timeouts
contract HeirloomVault {
    using SafeERC20 for IERC20;

    enum State {
        Uninitialized,
        PendingFunding,
        Active,
        ClaimPending,
        Releasing,
        Released,
        Cancelled
    }

    struct Config {
        bytes32 ownerXrplHash; // standard address hash = keccak256(owner r-address string)
        bytes32 beneficiaryXrplHash; // keccak256(beneficiary r-address string)
        bytes32 beaconHash; // keccak256(global heartbeat beacon r-address string)
        bytes32 heartbeatReference; // 32-byte standard payment reference for heartbeats
        uint64 heartbeatPeriod; // seconds owner may stay silent
        uint64 gracePeriod; // extra seconds before a claim may start
        uint64 challengePeriod; // seconds a pending claim can be vetoed by a heartbeat
        uint64 creationLedger; // XRPL validated ledger at creation (silence anchor #0)
        uint64 creationTs; // its close time (unix)
        uint256 lotSizeUBA; // FAssets lot size, cached at creation
    }

    // --- immutable-per-deployment (implementation constructor) ---
    IERC20 public immutable fxrp;
    IFAssetRedeemer public immutable assetManager;
    IFdcVerification private immutable _verificationOverride; // zero → ContractRegistry lookup

    // --- clone state ---
    State public state;
    Config public config;
    bytes32 public cancelReference; // keccak256("HEIRLOOM/CANCEL" ‖ heartbeatReference)

    uint64 public lastHeartbeatLedger;
    uint64 public lastHeartbeatTs;
    uint32 public heartbeatEpoch;
    uint64 public nextSilenceLedger; // next expected checkpoint minimalBlockNumber
    uint64 public silenceProvenThroughTs;
    uint64 public claimChallengeEndsAt;
    string public beneficiaryXrpl; // revealed at claim time (preimage of beneficiaryXrplHash)
    uint256 public crankRewardWei; // flat reward per successful keeper crank, from vault reserve

    event VaultActivated(uint256 fxrpAmount);
    event Heartbeat(uint32 indexed epoch, uint64 ledger, uint64 timestamp, bytes32 xrplTxRef);
    event ClaimVetoed(uint32 indexed epoch, uint64 ledger);
    event SilenceAttested(uint32 indexed epoch, uint64 fromLedger, uint64 throughLedger, uint64 throughTs);
    event ClaimStarted(string beneficiaryXrpl, uint64 challengeEndsAt);
    event ReleaseExecuted(uint256 requestedUBA, uint256 redeemedUBA, uint256 remainingFxrp);
    event Released(uint256 residualUBA);
    event ResidualBelowMinimum(uint256 residualUBA, uint256 protocolMinimumUBA);
    event CancelExecuted(string ownerXrpl, uint256 requestedUBA, uint256 redeemedUBA);
    event ReserveFunded(address indexed from, uint256 amount);

    error BadState(State current);
    error ProofInvalid();
    error NotOwnerHeartbeat();
    error WindowMismatch();
    error SilenceNotProven();
    error ChallengeNotOver();
    error BadPreimage();

    constructor(IERC20 _fxrp, IFAssetRedeemer _assetManager, IFdcVerification verificationOverride_) {
        fxrp = _fxrp;
        assetManager = _assetManager;
        _verificationOverride = verificationOverride_;
        state = State.Released; // implementation is never usable directly
    }

    function initialize(Config calldata c, uint256 _crankRewardWei) external payable {
        if (state != State.Uninitialized) revert BadState(state);
        require(c.ownerXrplHash != 0 && c.beneficiaryXrplHash != 0 && c.beaconHash != 0, "cfg");
        require(c.heartbeatReference != 0 && c.heartbeatPeriod > 0, "cfg");
        config = c;
        cancelReference = keccak256(abi.encodePacked("HEIRLOOM/CANCEL", c.heartbeatReference));
        lastHeartbeatLedger = c.creationLedger;
        lastHeartbeatTs = c.creationTs;
        nextSilenceLedger = c.creationLedger + 1;
        silenceProvenThroughTs = c.creationTs;
        crankRewardWei = _crankRewardWei;
        state = State.PendingFunding;
    }

    receive() external payable {
        emit ReserveFunded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------
    // funding
    // ---------------------------------------------------------------------

    /// @notice Anyone may flip the vault to Active once FXRP has arrived
    ///         (via direct mint to this address, 0xFE flow, or ERC-20 transfer).
    function activate() external {
        if (state != State.PendingFunding) revert BadState(state);
        uint256 bal = fxrp.balanceOf(address(this));
        require(bal > 0, "unfunded");
        state = State.Active;
        emit VaultActivated(bal);
    }

    // ---------------------------------------------------------------------
    // heartbeat (positive leg) — also the claim veto
    // ---------------------------------------------------------------------

    function recordHeartbeat(IXRPPayment.Proof calldata proof) external {
        if (state != State.Active && state != State.ClaimPending && state != State.PendingFunding) {
            revert BadState(state);
        }
        if (!_verification().verifyXRPPayment(proof)) revert ProofInvalid();
        IXRPPayment.ResponseBody calldata rb = proof.data.responseBody;
        if (rb.sourceAddressHash != config.ownerXrplHash) revert NotOwnerHeartbeat();
        require(rb.receivingAddressHash == config.beaconHash, "beacon");
        require(rb.status == 0, "status"); // SUCCESS
        require(rb.receivedAmount >= 1, "amount");
        require(rb.hasMemoData && rb.firstMemoData.length == 32, "memo");
        require(bytes32(rb.firstMemoData) == config.heartbeatReference, "reference");
        require(rb.blockNumber > lastHeartbeatLedger, "stale");

        lastHeartbeatLedger = rb.blockNumber;
        lastHeartbeatTs = rb.blockTimestamp;
        heartbeatEpoch += 1;
        nextSilenceLedger = rb.blockNumber + 1; // old epoch's checkpoints are void
        silenceProvenThroughTs = rb.blockTimestamp;

        if (state == State.ClaimPending) {
            state = State.Active;
            claimChallengeEndsAt = 0;
            emit ClaimVetoed(heartbeatEpoch, rb.blockNumber);
        }
        emit Heartbeat(heartbeatEpoch, rb.blockNumber, rb.blockTimestamp, proof.data.requestBody.transactionId);
    }

    // ---------------------------------------------------------------------
    // silence (negative leg) — rolling checkpoints, strictly chained
    // ---------------------------------------------------------------------

    function attestSilence(IReferencedPaymentNonexistence.Proof calldata proof) external {
        if (state != State.Active && state != State.ClaimPending) revert BadState(state);
        if (!_verification().verifyReferencedPaymentNonexistence(proof)) revert ProofInvalid();
        IReferencedPaymentNonexistence.RequestBody calldata req = proof.data.requestBody;
        IReferencedPaymentNonexistence.ResponseBody calldata res = proof.data.responseBody;

        require(req.destinationAddressHash == config.beaconHash, "beacon");
        require(req.amount == 1, "amount");
        require(req.standardPaymentReference == config.heartbeatReference, "reference");
        require(req.checkSourceAddresses, "sourceCheck");
        // single-owner source tree: root = keccak256(standardAddressHash(owner))
        require(req.sourceAddressesRoot == keccak256(abi.encodePacked(config.ownerXrplHash)), "sourceRoot");
        if (req.minimalBlockNumber != nextSilenceLedger) revert WindowMismatch();

        uint32 epoch = heartbeatEpoch;
        uint64 fromLedger = req.minimalBlockNumber;
        nextSilenceLedger = res.firstOverflowBlockNumber;
        silenceProvenThroughTs = res.firstOverflowBlockTimestamp;
        emit SilenceAttested(epoch, fromLedger, res.firstOverflowBlockNumber - 1, res.firstOverflowBlockTimestamp);
        _payCrank();
    }

    // ---------------------------------------------------------------------
    // claim → challenge → release
    // ---------------------------------------------------------------------

    function startClaim(string calldata beneficiaryXrpl_) external {
        if (state != State.Active) revert BadState(state);
        if (keccak256(bytes(beneficiaryXrpl_)) != config.beneficiaryXrplHash) revert BadPreimage();
        if (silenceProvenThroughTs < lastHeartbeatTs + config.heartbeatPeriod + config.gracePeriod) {
            revert SilenceNotProven();
        }
        state = State.ClaimPending;
        beneficiaryXrpl = beneficiaryXrpl_;
        claimChallengeEndsAt = uint64(block.timestamp) + config.challengePeriod;
        emit ClaimStarted(beneficiaryXrpl_, claimChallengeEndsAt);
    }

    /// @notice After the challenge period, redeem the vault's full FXRP
    ///         balance to the beneficiary's own XRPL address (arbitrary-amount
    ///         redemption). Re-crankable: FAssets may fulfil a request only
    ///         partially (`RedemptionAmountIncomplete`), in which case another
    ///         crank redeems the remainder.
    function executeRelease() external payable {
        if (state == State.ClaimPending) {
            if (block.timestamp < claimChallengeEndsAt) revert ChallengeNotOver();
            state = State.Releasing;
        }
        if (state != State.Releasing) revert BadState(state);

        (uint256 requested, uint256 redeemed) = _redeemAll(beneficiaryXrpl);
        uint256 remaining = fxrp.balanceOf(address(this));
        emit ReleaseExecuted(requested, redeemed, remaining);
        if (remaining == 0) {
            state = State.Released;
            emit Released(0);
        } else if (remaining < assetManager.minimumRedeemAmountUBA()) {
            // a residual below the protocol's redemption minimum can never be
            // redeemed; close honestly instead of leaving the state re-crankable
            // forever. The residual stays visible in the vault.
            state = State.Released;
            emit ResidualBelowMinimum(remaining, assetManager.minimumRedeemAmountUBA());
            emit Released(remaining);
        }
        _payCrank();
    }

    // ---------------------------------------------------------------------
    // owner cancel — a pure XRPL action (payment with the cancel reference)
    // ---------------------------------------------------------------------

    function cancel(string calldata ownerXrpl_, IXRPPayment.Proof calldata proof) external payable {
        if (state != State.PendingFunding && state != State.Active && state != State.ClaimPending) {
            revert BadState(state);
        }
        if (keccak256(bytes(ownerXrpl_)) != config.ownerXrplHash) revert BadPreimage();
        if (!_verification().verifyXRPPayment(proof)) revert ProofInvalid();
        IXRPPayment.ResponseBody calldata rb = proof.data.responseBody;
        if (rb.sourceAddressHash != config.ownerXrplHash) revert NotOwnerHeartbeat();
        require(rb.receivingAddressHash == config.beaconHash, "beacon");
        require(rb.status == 0, "status");
        require(rb.hasMemoData && rb.firstMemoData.length == 32, "memo");
        require(bytes32(rb.firstMemoData) == cancelReference, "reference");

        state = State.Cancelled;
        (uint256 requested, uint256 redeemed) = _redeemAll(ownerXrpl_);
        emit CancelExecuted(ownerXrpl_, requested, redeemed);
    }

    // ---------------------------------------------------------------------
    // views & internals
    // ---------------------------------------------------------------------

    function silenceDeadline() public view returns (uint64) {
        return lastHeartbeatTs + config.heartbeatPeriod + config.gracePeriod;
    }

    function status()
        external
        view
        returns (
            State s,
            uint256 fxrpBalance,
            uint64 lastAliveTs,
            uint64 provenThroughTs,
            uint64 deadline,
            uint64 challengeEndsAt,
            uint32 epoch,
            uint64 expectedNextSilenceLedger
        )
    {
        return (
            state,
            fxrp.balanceOf(address(this)),
            lastHeartbeatTs,
            silenceProvenThroughTs,
            silenceDeadline(),
            claimChallengeEndsAt,
            heartbeatEpoch,
            nextSilenceLedger
        );
    }

    function _redeemAll(string memory underlying) internal returns (uint256 requestedUBA, uint256 redeemedUBA) {
        uint256 bal = fxrp.balanceOf(address(this));
        if (bal >= assetManager.minimumRedeemAmountUBA()) {
            requestedUBA = bal;
            fxrp.forceApprove(address(assetManager), bal);
            redeemedUBA = assetManager.redeemAmount{value: msg.value}(bal, underlying, payable(msg.sender));
        }
    }

    function _verification() internal view returns (IFdcVerification v) {
        v = _verificationOverride;
        if (address(v) == address(0)) v = ContractRegistry.getFdcVerification();
    }

    function _payCrank() internal {
        uint256 r = crankRewardWei;
        if (r > 0 && address(this).balance >= r) {
            (bool ok, ) = msg.sender.call{value: r}("");
            ok; // best-effort; a failing reward must never block the crank
        }
    }
}
