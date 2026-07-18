// Chain-calibrated clock: deadlines are consensus facts, so the UI must not
// trust the local system clock. One block fetch pins the offset; local
// monotonic time carries it forward.
import { provider } from "./chain";

let offsetSec = 0;
let synced = false;
async function sync() {
  try {
    const b = await provider.getBlock("latest");
    if (b) {
      offsetSec = Number(b.timestamp) - Math.floor(Date.now() / 1000);
      synced = true;
    }
  } catch { /* fall back to local time until the next sync */ }
}
void sync();
setInterval(sync, 5 * 60_000);

export const chainNow = () => Math.floor(Date.now() / 1000) + (synced ? offsetSec : 0);
