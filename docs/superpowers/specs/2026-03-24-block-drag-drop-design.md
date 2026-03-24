# Block Drag & Drop — Design Spec

## Summary

Add drag-and-drop for selected blocks in the block editor. When one or more blocks are selected (via the existing Roam-style block selection), a drag handle appears on hover. Dragging moves the selected blocks to a new position, with optional indentation change based on horizontal cursor movement.

## Interaction Model

### Trigger
- **Precondition**: One or more blocks must be selected (existing `block-selected` class / `selectedBlockIdsRef`).
- **Handle visibility**: When the cursor hovers over a selected block's row, a `⠿` grip icon appears in place of (or before) the bullet. The handle is hidden when no blocks are selected.
- **Drag start**: `mousedown` on the handle initiates the drag. No drag from other parts of the block.

### During Drag
- **Ghost element**: A small floating element follows the cursor showing the first block's text (and a count badge if multiple blocks are selected).
- **Source blocks**: The dragged blocks get reduced opacity (`dragging-source` class).
- **Drop indicator**: A horizontal blue line (2px, accent color, with a circle on the left end) appears between blocks to show the insertion point.
- **Indentation**: Horizontal cursor movement relative to drag start shifts the drop indicator left/right. Each 36px of horizontal delta = 1 indent level. The indicator's left offset reflects the target depth. Depth is clamped: minimum 0, maximum = reference block's depth + 1 (can only nest one level deeper than an existing block).
- **Browser text selection**: Disabled during drag (existing `block-select-active` CSS handles this).

### On Drop
- Extract the selected root blocks (using existing `_filterRoots` logic — parents only, children come along).
- Remove them from the block tree.
- Insert them at the drop position:
  - **Same depth as reference block**: Insert before/after as sibling.
  - **Deeper than reference block**: Insert as last child of the reference block (when dropping after it at depth + 1).
  - **Shallower**: Insert after the appropriate ancestor at the target depth.
- Preserve selection state after drop.
- Trigger `onChange` to persist.

### On Cancel
- `Escape` during drag cancels: hide ghost + indicator, restore original positions, no state change.

## Affected Files

| File | Changes |
|------|---------|
| `BlockEditor.tsx` | Add drag state refs, mousedown/move/up handlers on the editor container, ghost + indicator rendering, drop logic using existing tree helpers |
| `BlockItem.tsx` | Add `⠿` handle element (conditionally visible), pass selection state for handle visibility |
| `BlockItem.css` | Style `.block-handle`, visibility rules (selected + hover), `.dragging-source` opacity |
| `BlockEditor.css` | Style `.drop-indicator`, `.drag-ghost` |

## Data Flow

1. **BlockEditor** owns all drag state (refs): `isDragActive`, `dragSourceIds`, `dropTarget`, `dragStartX`.
2. **BlockItem** receives a `isSelected` boolean prop (or reads it from a context/ref) and renders the handle conditionally.
3. Handle's `mousedown` calls a callback from BlockEditor that starts the drag.
4. BlockEditor's `mousemove` on `document` computes drop target and updates indicator position.
5. `mouseup` calls the drop logic which mutates the block tree via `onChange`.

## Constraints
- No new dependencies. Pure DOM events + existing block tree helpers.
- Mac only (desktop). On mobile/iPhone the feature is not active (no hover states).
- Must work with the existing undo/redo system — push to undo stack before applying the drop.
- Must coexist with existing block selection drag (drag-past-bullet to select). The two are mutually exclusive: selection drag activates when no blocks are selected; block move drag activates from the handle when blocks are already selected.
