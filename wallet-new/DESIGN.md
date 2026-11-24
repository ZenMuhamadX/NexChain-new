# wallet-new design source

An NXC wallet popup with the calm, rounded feel of Phantom and its own
identity. `wallet/` is not a reference and is not copied.

## Dial

ENERGY 2 / RHYTHM 2 / MOTION 2. A wallet should feel quiet and trustworthy
without feeling sterile. The home screen is dense, auth screens are open.
Motion is smooth without parallax or extra choreography.

## Tokens

Phantom-inspired dark direction, chosen by the owner against the reference
screenshot. Purple is the one accent, used sparingly.

| Role        | Value                 | Reason                                                 |
| ----------- | --------------------- | ------------------------------------------------------ |
| Canvas      | `#000000`             | Pure black ground, chosen by the owner                 |
| Ink         | `#f4f4f7`             | Primary text on the canvas                             |
| Surface     | `#16161c`             | Rows, sheets, inputs: one step above the canvas        |
| Soft tile   | `#1a1a21` / `#eceaf7` | Secondary buttons and chips                            |
| Accent      | `#8f7ff5`             | The one purple: CTAs, focus, active nav                |
| Accent text | `#b9adff`             | Purple when it must carry text on dark                 |
| Muted       | `#9a9ab0`             | Secondary copy with AA contrast on the canvas          |
| Danger      | `#ff9a8b`             | Lightened so errors read on dark, distinct from purple |
| Line        | `#2a2a33`             | Hairline borders and dividers                          |

Measured ratios: ink 17.6:1, muted 7.2:1, accent text 9.9:1 on the canvas;
soft-ink 14:1 on soft tiles; near-black `#120e26` on the purple fill 5.9:1,
so primary buttons carry dark labels (white on this purple would fail AA).
Danger 9:1 on the canvas.

Typography: system sans from 400 to 700 with `letter-spacing: -0.02em`. No
webfont because MV3 cannot download external fonts and the popup must paint
immediately.

Radius: 16 for inputs and chips, 24 for cards and buttons, 28 for sheets, 999
for status pills and avatars. One soft purple glow on the primary CTA. Inline
SVG icons drawn for this wallet, one glyph per meaning. The brand mark and
hero on the auth screens use `brand/asset/nexchain_blockchain_transparent.svg`;
the NXC token row uses `brand/asset/nxc_ticker_transparent.svg`. Both are
imported from the shared kit rather than copied, and the toolbar icon is
deliberately absent.

## Screens

Welcome introduces the wallet with one primary CTA. Setup shows the mnemonic
in a two-column grid, a Copy button, a saved confirmation, then the passphrase.
Import uses a labelled textarea. Unlock uses a passphrase field with show and
hide.

Home follows the reference layout: an account header (hue avatar derived from
the address, truncated address, Copy), the balance centered straight on the
canvas with no card chrome, then two tall action tiles (Send, Receive) with a
24px medallion icon over the label, and one NXC token row. Receive uses a QR
glyph. There is no separate reload button in the header. The amount is compact
by default, with full precision behind a Full toggle. A Recent activity section
shows up to five rows from the first page; the full paginated list stays in the
History tab.

Send is a bottom sheet with three steps: form, review, and success with the
txHash. The amount field carries a visible NXC suffix. The review is a receipt:
large amount, recipient with Copy, optional message, and a quiet `Network fee,
auto` footer. The primary action reads `Sign and send`. The success view shows
the txHash with a `View in Explorer` link built from that value. Both sheets slide
down on close, including the `Done` button on success. Receive is a full-screen
view on pure black that slides up with the same `sheet-up` motion as the sheets.
It follows the wallet's 14px type scale: a compact header, a 180px white QR
card, the full address at 15px in a split card with Copy, and a 48px pill Close
button. The QR is generated from the live address by `qrcode` at error
correction H, with the official NXC ticker inverted over its centre.
Activity uses the text label `Pending`, not only a colored dot. Its reload button
uses a refresh icon that makes one 560ms turn on each press. Every row with a
txHash gets an external-link icon that opens `/tx/<hash>`, pending rows included.
Sent uses a right arrow and incoming rows a left arrow.
All explorer links open in a new tab with `noopener noreferrer`.
History loads one page at a time (25 rows): a `Page x of y` caption and a `Load
more` button append the next page, and pending rows appear only on the first page.
The Settings `Explorer URL` field overrides the default public explorer
(`https://explorer.zuns.my.id`) for every link.

Settings holds the RPC URL and credentials, public keys, wallet lock, and a
delete action with the native confirmation dialog. The Keys section also shows
the seed phrase and private key behind `Show`. Revealing either asks for the
wallet passphrase again, offers no Copy action, and hides itself after 60
seconds or when the popup loses focus.

Bottom navigation has three items: Home, History, Settings. Every item has a
real destination. The active item has no pill or tinted background: its icon
turns solid purple. Home crossfades from outline to a filled glyph, History
ticks its hands once, and Settings spins its cog once.

## Motion

Screen transitions are 180ms fade plus an 8px shift. Sheets rise and fall over
240ms while the backdrop fades; the frame uses `overflow: clip` so the entry
transform cannot scroll the screen behind it. The Home glyph fills over 200ms;
the History hands and the Settings cog each make one 560ms turn when their tab
is selected. The balance dims and brightens only when its value
changes. Buttons scale to 98% when pressed. The success check draws its short leg first and then the long one, while the
badge gives a short spring pop, followed by the text and action. The
skeleton shimmer runs only while data loads. Every motion stops under
`prefers-reduced-motion: reduce`. No loops, floating, or parallax.

## States and accessibility

Every data view has an empty state that names the reason and the next action,
a loading state that names what is loading, and a failure state with a retry
action. Controls are native, have accessible names, meet a 44px target with
8px gaps, show a visible focus ring, and sheets close with Escape.
