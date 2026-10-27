# Evidence: PlayStation 5 disc edition (CFI-1000) exploded view

**Intended use:** an explanatory illustration of how the original PS5 disc edition's main components fit together. It is not a service or manufacturing drawing. Nothing is toleranced, and the sheet is not to scale (NTS).

**Output:** `dist/index.html`, a standalone viewer that opens from disk and switches between exploded and assembled views. It downloads SVG, PNG (A3 at 300 dpi, 4961 × 3508 px) and PDF (A3 vector).

## Sources

- **[iFixit]** PlayStation 5 teardown, guide 138280: https://www.ifixit.com/Teardown/PlayStation+5+Teardown/138280
- **[Sony]** Official PS5 teardown video narrated by Yasuhiro Ootori, October 2020, as reported by [VGC](https://videogameschronicle.com/news/official-sony-playstation-5-teardown-video-reveals-the-consoles-internal-components), [GameSpot](https://gamespot.com/articles/ps5-official-teardown-video-gives-great-view-of-internals/1100-6483012/) and [Gigazine](https://gigazine.net/gsc_news/en/20201008-playstation-5-tear-down)
- **[HH]** HotHardware's summary of the iFixit teardown: https://hothardware.com/news/sony-playstation-5-independent-teardown-ifixit
- **[Spec]** Sony's published size for the disc edition: approx. 390 × 104 × 260 mm (H × W × D), excluding the largest projection and the base

## Feature groups

| Feature group | Evidence kind | How it is drawn |
| --- | --- | --- |
| Overall envelope, 390 × 104 × 260 mm | Supplied dimensions [Spec] | Preserved. Covers span ±52 mm, height 390 mm, depth 260 mm |
| Side-cover outline (curved front edge) | Estimated from photographs | Flat 8 mm plates with an inward curve at mid-height. The real covers are curved shells that flare more |
| Two removable white side covers, tool-free | Confirmed [iFixit] [Sony] | Separate parts at each end of the stack |
| Black chassis halves, front vents, disc slot, front USB-A and USB-C, power and eject buttons | Parts confirmed [iFixit]; positions estimated | Each half is a plate plus a perimeter wall. Port and button outlines are approximate |
| Rear ports (2 × USB-A, LAN, HDMI 2.1, 2-pin power) | Confirmed [iFixit] | **Not shown**: they sit on the back face, which this camera cannot see |
| Fan, 120 mm diameter × 45 mm thick, squirrel cage, double-sided intake | Confirmed [iFixit] [Sony] | Drawn to size. Its placement near the top is from photographs; the blade count (60) is illustrative |
| Two dust catchers, vacuumed through two holes | Confirmed [Sony] | Two holes in the heatsink-side chassis half. Their **position is illustrative** |
| M.2 expansion bay with a cover held by one screw | Confirmed [iFixit] [HH] | Window, cover and slot. **Position is illustrative** |
| Ultra HD Blu-ray drive, removed after the first chassis half | Confirmed [iFixit] | Box with a disc outline. Size and position estimated |
| Power supply, 350 W, Delta, enclosed | Confirmed [iFixit] | Box with a vent pattern. **Size and position are illustrative** |
| Two steel shields, one on each side of the board | Confirmed [iFixit] ("steel plate", "second metal shield") | Thin plates. Cutouts and screw positions are illustrative |
| Heatsink with copper heat pipes and fin stacks; no vapor chamber; liquid-metal TIM on the SoC | Confirmed [iFixit] [HH] | Contact block, pipes and fin block. **Pipe count (5), fin pitch and block shapes are illustrative**. The liquid metal is not drawn |
| SoC CXD90060GG, SSD controller CXD90062GG, Wi-Fi module J20H100 | Chip markings confirmed [iFixit] | Labelled packages. **Board positions are illustrative** |
| GDDR6: 16 GB as 2 GB Micron chips, so 8 chips | Count derived from [iFixit] | Eight packages around the SoC. The arrangement is illustrative |
| NAND: six Kioxia BiCS chips, three per side ("likely") | [iFixit], marked likely | The three on the visible side are drawn. **Positions are illustrative** |
| SoC facing the heatsink side of the board | Estimated from teardown photographs | The drive and PSU are on the opposite side |
| Base stand and its screw, stored in a cubby in the stand | Confirmed [iFixit] | Stand shape simplified to a turned disc (**illustrative**) |

The drawing keeps `concept: true`, so its exports are marked illustrative.

## Rebuild and proof

```sh
npm install                                   # jspdf, svg2pdf.js, @fontsource-variable/inter
node tools/teardown/scripts/proof.cjs drawing.json proof/ --quick      # assembled + exploded
node tools/teardown/scripts/proof.cjs drawing.json proof/              # + spread and the occlusion check
node scripts/annotated-proof.cjs drawing.json proof/ 1                 # labelled sheet
node tools/teardown/scripts/build-viewer.cjs drawing.json dist/index.html
node tools/teardown/scripts/check-viewer.cjs dist/index.html check/    # add --dark for dark mode
node scripts/download-check.cjs dist/index.html check/downloads        # drives every export
```
