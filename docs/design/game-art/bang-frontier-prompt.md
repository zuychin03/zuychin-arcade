# BANG! frontier miniature

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Built-in imagegen preparation for the approved tactile redesign, 22/09/2026. Decorative atmosphere only; no player role, hand or character identity is represented.

## Exact generation prompt

Use case: stylized-concept
Asset type: original horizontal 3:2 entrance and library illustration for a mobile-first tabletop Western card-game app.
Primary request: a premium miniature frontier saloon corner arranged on a low worn-timber tabletop base. A small saloon facade and porch provide a clear backdrop to a simple round card table, a closed stack of blank-backed thick cards, a plain aged-brass sheriff-style badge and a weathered dark hat. A few small wooden life-marker pieces sit beside the table, without numbers or a meaningful count arrangement.
Style/medium: photographed hand-painted architectural miniatures and finely crafted props, real timber grain, thick paper edges, worn leather and aged brass. Tactile physical depth, imperfect craftsmanship and soft contact shadows. No flat vector art or UI mock-up.
Composition/framing: slightly elevated three-quarter product view, compact scene with complete roof, porch and base comfortably inside the horizontal frame. The table and props read clearly at phone size. No distant town, human figures, large empty text area or detailed weapon display.
Lighting/palette: warm brass #F6C453 lantern light, dark brown #120A08 background, sand #E8C99B timber detail and restrained red #FF5D55 accents. Readable warm shadows, no neon or excessive bloom.
Constraints: original props and architecture, no commercial game art, recognisable real person, publisher characters, printed wanted posters, words, numbers, lettering, logos, watermark, card values or UI. The badge is blank and has no real police organisation insignia. No graphic violence or cultural caricatures. All game roles, identities and rules remain live interface content supplied separately.

## Framing correction

The first generated image, `exec-7fd8a9c2-531b-436b-a96c-ee3198dc2b79.png`, cropped the building and base. It was retained in the generation output directory, not used as the production source. The following edit used that image as its sole reference:

Edit the supplied original miniature frontier saloon image. Change ONLY the camera framing and complete currently cropped architecture/base, preserving its material quality, warm brass lantern lighting, brown timber palette, round table, blank red-backed cards, plain blank badge, dark leather hat, and tiny wooden markers. Pull the camera back substantially so the entire small saloon facade INCLUDING its top roof silhouette and the entire low tabletop plinth base are comfortably inside the image, with approximately 10% dark brown background margin around every outer edge. Keep a horizontal 3:2 composition and elevated three-quarter product-photography view. This should clearly read as a complete handcrafted miniature diorama, not a cropped life-size building. Reduce overall building height if necessary so the table and props still read at phone size. Keep natural physical contact shadows and finely crafted textured materials; no humans, weapons, words, numbers, lettering, branding, watermark, UI, meaningful token values, or new distracting objects. Do not crop any roof, base, table, chair or barrel. Full contained composition.

## Recorded output

The edited original `exec-a3abc229-3c34-41fc-8921-bc8d1e5a3ade.png` was copied unchanged to `bang-frontier-concept.png`: 1536×1024, 2,628,380 bytes, SHA256 `aeada8d3373de6116c4717bef4023814a1a41d2861df52ab21331461d3e9f8fc`. The complete roof and base are visible, although the top margin is smaller than requested. Root inspected the original and optimised cover. Deterministic width-only WebP outputs total 216,754 bytes; encoding, dimensions and hashes are in `apps/mobile/assets/game-art/bang-manifest.json`. This is asset preparation, not rendered game acceptance.
