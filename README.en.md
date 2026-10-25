# PULLTOSEND

Press the DSH composer, pull upward, release — the message flies out. Built for "the send button is too small to hit, and Enter needs both hands."

[中文](./README.md)

![demo](./demo.gif)

## Install

```bash
dsh plugin --profile desktop add "github:dhdkfkfkf/dsh-pull-to-send"
```

Restart DSH once after installing (adding the bundle itself needs a restart; code edits hot-reload via dsh-hmr afterwards).

## The gesture

| Action | Result |
| --- | --- |
| Press the composer card (a 12px halo around it counts too), pull up past its top edge by ≥14px | Armed: a clone of the input lifts off and follows the pointer (damped follow, slight scale-up, deeper shadow) while the real input shrinks and dims; hovering shows a grab cursor, dragging switches to grabbing |
| Release while armed | Fires the send control's current primary action (idle = send, generating = queue/steer); the clone FLIPs into the new message bubble with a crossfade |
| Below threshold / horizontal-dominant drag / Esc / pointercancel | Cancel: the clone flies back along its path in 320ms |

| Never interrupted | Why |
| --- | --- |
| Selecting text inside the box | The gesture arms only after the pointer leaves the top edge; in-card selection stays 100% native |
| Empty draft / disabled send button | Never arms; releasing does nothing |
| IME composition in flight | The gesture cancels the moment composition starts; half-typed Pinyin never sends |
| Touch | Only mouse and pen respond; scrolling never accidentally sends |
| Buttons / links / menus on the card | Their presses are their own |

## Tunables

Zero build, single-file `client.js`; every parameter is a named constant at the top of the file (v1 has no settings panel):

| Constant | Default | Meaning |
| --- | --- | --- |
| `ARM_DISTANCE` | 14px | Distance past the composer's top edge before arming |
| `HIT_PAD` | 12px | Invisible hit-area halo around the card |
| `HINT_AFTER_PX` | 8px | Pull distance before the hint pill appears |
| `HINT_GAP_PX` | 16px | Gap between the hint pill and the pointer |
| `DAMPING` | 0.95 | Per-frame follow factor of the clone toward the pointer (higher = tighter tracking) |
| `MAX_SCALE` | 1.02 | Clone scale at full lift |
| `FLIP_MS` | 400ms | Flight time of the send FLIP into the bubble |
| `BUBBLE_LEAD_MS` | 80ms | How early the real bubble fades in before landing |
| `RETURN_MS` | 200ms | Real composer return time (does not wait for the flight) |
| `CANCEL_MS` | 320ms | Cancel fly-back time |

## Local test bench

Try it without installing anything: open `test.html` in any browser. A built-in shim activates `client.js` immediately against a mock DOM that replicates every anchor (sending, bubble landing, a simulated reply, queue-while-generating), so the gesture and animation are the real code paths.

## Compatibility

Works in both the claude-style and the native surface (they share the same `data-composer-*` anchors); embedded conversation panes each get their own gesture. The send path is verified: a programmatic `.click()` on the send button really sends under React/Lexical (measured with a CDP probe).

## License

MIT
