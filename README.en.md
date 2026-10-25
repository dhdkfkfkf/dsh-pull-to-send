# PULLTOSEND

Press the DSH composer, pull upward, release — the message flies out. Keep holding to drag it back and cancel, or drag clear of the conversation to void it.

Three drags turn sending into muscle memory:

- **Pull out to send** — drag up from the composer; the message hangs in the air, and letting go sends it.
- **Pull back to cancel** — change your mind and drag the pointer back into the composer; everything returns and the draft is still there.
- **Pull away to cancel** — fling it to the screen edge, the task bar or another window and the gesture is voided on the spot, never mis-sent.

[中文](./README.md)

## Install

```bash
dsh plugin --profile desktop add "github:dhdkfkfkf/dsh-pull-to-send"
```

Restart DSH once after installing (adding the bundle itself needs a restart; code edits hot-reload via dsh-hmr afterwards).

## The three drags

| What you do | What happens |
| --- | --- |
| **Pull out**: press the composer card (a 12px halo around it counts too), pull up past its top edge by **≥24px** | Armed: a clone of the input lifts off and follows the pointer (damped follow, slight scale-up, deeper shadow) while the real input shrinks and dims; hovering shows a grab cursor, dragging switches to grabbing |
| **Release** while armed | Fires the send control's current primary action (idle = send, generating = queue/steer); the clone FLIPs into the new message bubble with a crossfade |
| **Pull back**: drag the pointer back into the composer card while armed | Disarms: the clone returns in 150ms and vanishes, the card restores, the draft is untouched; pulling out again in the same press re-arms, so you can change your mind as often as you like |
| **Pull away**: drag the pointer out of the droppable area while armed | Cancels immediately: the clone springs back along its path, the cursor restores, this press is spent, releasing sends nothing, and a new drag has to start from the composer |
| Below threshold / horizontal-dominant drag / released inside the card / Esc / pointercancel | Cancel: the clone flies back along its path in 320ms |

### The droppable area

A release only sends when it lands inside this area:

| Edge | Where |
| --- | --- |
| Left | The composer card's left edge |
| Right | The conversation surface's right edge |
| Top | The top of the conversation area |
| Bottom | The composer card's top edge |

Anything outside is a cancel — the screen edge, the task bar, another application. To keep a pointer pinned to the screen edge detectable as "outside", the right edge is additionally inset by 8px.

No text prompts anywhere: the lifted clone itself is the armed signal.

## Never interrupted

| Case | Why |
| --- | --- |
| Selecting text inside the box | The gesture arms only after the pointer passes the top edge by 24px; in-card selection stays 100% native |
| Empty draft / disabled send button | Never arms; releasing does nothing |
| IME composition in flight | The gesture cancels the moment composition starts; half-typed Pinyin never sends |
| Touch | Only mouse and pen respond; scrolling never accidentally sends |
| Buttons / links / menus on the card | Their presses are their own |
| Releasing outside the window | Treated as a cancel |

## Tunables

Zero build, single-file `client.js`; every parameter is a named constant at the top of the file (v1 has no settings panel):

| Constant | Default | Meaning |
| --- | --- | --- |
| `ARM_DISTANCE` | 24px | Distance past the composer's top edge before arming |
| `EDGE_MARGIN` | 8px | Safety gap kept between the droppable area and the window edge |
| `DISARM_RETURN_MS` | 150ms | Clone return time when dragged back into the card |
| `HIT_PAD` | 12px | Invisible hit-area halo around the card |
| `DAMPING` | 0.95 | Per-frame follow factor of the clone toward the pointer (higher = tighter tracking) |
| `MAX_SCALE` | 1.02 | Clone scale at full lift |
| `FLIP_MS` | 400ms | Flight time of the send FLIP into the bubble |
| `BUBBLE_LEAD_MS` | 80ms | How early the real bubble fades in before landing |
| `RETURN_MS` | 200ms | Real composer return time (does not wait for the flight) |
| `CANCEL_MS` | 320ms | Cancel fly-back time |

## If something goes wrong

In the console:

```js
window.__DSH_PULLTOSEND__.disable()   // stop the gesture now (no restart, no uninstall)
window.__DSH_PULLTOSEND__.version     // confirm the plugin is actually loaded
```

`disable()` removes every listener and puts back any lifted clone; reload the page to re-enable.

## Local test bench

Try it without installing anything: open `test.html` in any browser. A built-in shim activates `client.js` immediately against a mock DOM that replicates every anchor (sending, bubble landing, a simulated reply, queue-while-generating), so the gesture and animation are the real code paths.

## Compatibility

Works in both the claude-style and the native surface (they share the same `data-composer-*` anchors); embedded conversation panes each get their own gesture. The send path is verified: a programmatic `.click()` on the send button really sends under React/Lexical (measured with a CDP probe).

Anchor lookup degrades in three steps: the semantic `data-composer-*` attributes first, then `aria-label` / `contenteditable` heuristics, and only as a last resort fuzzy class matching — any single hit is enough to work.

## License

MIT
