// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";
import {IReferencedPaymentNonexistence} from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";

/// @dev Not `is IFdcVerification` on purpose — only the two selectors the vault
///      actually calls need to exist at this address (typed to match exactly).
contract MockFdcVerification {
    bool public xrpPaymentOk = true;
    bool public rpnOk = true;

    function setXrpPaymentOk(bool v) external {
        xrpPaymentOk = v;
    }

    function setRpnOk(bool v) external {
        rpnOk = v;
    }

    function verifyXRPPayment(IXRPPayment.Proof calldata) external view returns (bool) {
        return xrpPaymentOk;
    }

    function verifyReferencedPaymentNonexistence(IReferencedPaymentNonexistence.Proof calldata)
        external
        view
        returns (bool)
    {
        return rpnOk;
    }
}

contract MockFxrp is ERC20 {
    constructor() ERC20("Mock FXRP", "FXRP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract MockAssetManager {
    IERC20 public immutable fxrp;
    uint256 public immutable lotSizeUBA;
    string public lastUnderlying;
    address public lastExecutor;
    uint256 public lastLots;

    constructor(IERC20 _fxrp, uint256 _lotSizeUBA) {
        fxrp = _fxrp;
        lotSizeUBA = _lotSizeUBA;
    }

    function redeem(uint256 _lots, string memory _redeemerUnderlyingAddressString, address payable _executor)
        external
        payable
        returns (uint256 _redeemedAmountUBA)
    {
        lastLots = _lots;
        lastUnderlying = _redeemerUnderlyingAddressString;
        lastExecutor = _executor;
        _redeemedAmountUBA = _lots * lotSizeUBA;
        // pull the redeemed FXRP from the caller (like burning for redemption)
        fxrp.transferFrom(msg.sender, address(this), _redeemedAmountUBA);
    }
}
