# Eon — Liquid Glass

The accepted direction is balanced, readable glass. Preserve all five themes,
Eon's planet logo, the three separate navigation groups and existing workflows.
The interface is an operating workspace, not a visual effects demonstration.

## Materials

`src/eon2/eon-glass.css` owns desktop materials. `--glass-chrome` is the lighter
floating layer for navigation, section title and connection status. It uses a
bounded 24px backdrop blur, subtle diagonal light and a fine inner edge.
`--glass-content` is denser and protects notes, settings and device information.
Controls within a material use tinted fills rather than another backdrop blur.
Use the existing theme accents for selection and focus, never for text halos.

The title shows the active section once. The planet logo belongs to the separate
home island. Windows keeps its native caption controls; the desktop title reserves
their area and keeps the rest draggable. The connection chip opens Devices.

## Android and Desk

The MaterialTheme color scheme in `MainActivity.kt` owns the matching Android
palette. `LandscapeDeck.kt` adds a bounded material brush; it never blurs widget
text or telemetry. The desktop preview uses matching colors, transparency,
spacing and selection semantics. Native rendering is an approximation, not
Apple's proprietary Liquid Glass renderer. Keep safe insets and equal top/side
content padding.

## Accessibility and performance

Keep readable text, keyboard focus and immediate press feedback. Reduced-motion
disables movement. Reduced-transparency and increased-contrast media preferences
select opaque desktop materials. Unsupported backdrop filtering also falls back
to opaque surfaces. Avoid nested backdrop filters, pointer-driven shader loops
and blur animations. No additional runtime dependencies are needed.

Reference: https://developer.apple.com/design/human-interface-guidelines/materials

The desktop appearance setting offers Glass (the accepted default), System and
Opaque. System follows reduced transparency; increased contrast always takes
priority. This local appearance preference persists on the desktop.
