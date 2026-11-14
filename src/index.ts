import { createMod } from "@sculptr/sdk";

/**
 * Gives back the pixels a game is short of a whole block.
 *
 * ## The design error this is for
 *
 * These games are built out of 32x32 blocks, so a screen is 800x608 -- 25 blocks across, 19 down.
 * A handful of them ship with their view set to 800x**600** instead, which is not a whole number of
 * blocks: the bottom quarter-block of every screen is simply never drawn. "I wanna see the moon" is
 * the clearest case. 97 of its 101 rooms are 800x608 (or a multiple of it) with a view of 800x600,
 * and its own camera snaps that view on a 608 grid -- `view_yview = floor(player.y/608)*608` -- so
 * the author was designing for 608 throughout and only the view says otherwise.
 *
 * It is not something the player can work around: those 8 pixels can hide a spike, a block edge, or
 * the floor they were meant to land on.
 *
 * ## The rule
 *
 * The region the game draws into is rounded **up** to whole blocks. Nothing is ever shrunk, and the
 * most it can grow is 31 pixels, so a game that was already right is untouched.
 *
 * Which thing has to be moved to do that depends on the room, and there are two kinds:
 *
 * - **Views on.** Every visible, *unscaled* view is grown to the next multiple of 32 -- 600 becomes
 *   608, and 800 (already 25 blocks) is left alone. "Unscaled" means the port matches the view
 *   (`view_wview == view_wport`): a game drawing a view at a deliberately different size has an
 *   intent of its own, and growing one half of that pair would change its scale rather than reveal
 *   anything. Those rooms are left as they are.
 *
 * - **Views off**, which means the region is the room itself -- how a title screen or a menu is
 *   usually built, and 800x600 there is the same 8 pixels short as anywhere else. There is no view
 *   to grow, so the room is given one: view 0, at the origin, covering the whole room rounded up to
 *   blocks. That is what views-off already means, said in a way that can be a size the room is not.
 *   A room whose size is *already* whole blocks keeps its views off and is not touched at all.
 *
 *   Two details matter when enabling a view that was never meant to be used. Its stored geometry is
 *   whatever the room editor last left there -- in "I wanna see the moon" all four of those rooms
 *   carry a stale 640x480 -- so every field is set rather than trusted, including the follow target,
 *   which would otherwise drag the view around after an object. And the other seven views are put
 *   out of the way first, because their flags were never meaningful while views were off: in a room
 *   holding fewer than eight of them, a write past the end lands back on view 0, so view 0 is
 *   configured last.
 *
 * ## Why the window has to be told
 *
 * A view is only a window onto the room; what is actually rasterised is the *drawing region*, and
 * that is set once per room from the room's own size or view ports. Growing a port alone would leave
 * the extra 8 pixels outside the framebuffer -- clipped, so nothing would look any different. So the
 * region follows, with `window_set_region_size`, which is GameMaker's own way to change resolution
 * without changing rooms.
 *
 * The canvas then has to follow the region, but only when it was tracking it 1:1 to begin with.
 * Under a fixed scale, or fullscreen on an installed copy, the window is deliberately a different
 * size from the region and the engine's own scaling maps one onto the other; resizing it there
 * would fight that. Comparing the two before touching either is what tells those cases apart --
 * no need to ask how the game was configured.
 *
 * ## Begin Step, not Create
 *
 * A room change reloads the room from the game's own data, which puts the short view back. So the
 * fix is reapplied every frame rather than once, and it is Begin Step because that is the first
 * code to run in a new room's first frame: GameMaker draws nothing between loading a room and the
 * begin step that follows, so no frame is ever presented at the wrong size. Once a room is right
 * the whole thing costs a loop over 8 views and one comparison.
 *
 * ## No panel
 *
 * There is nothing to show and nothing to set: the right size is the game's own grid, not a
 * preference, and whether it applied is visible in the game itself. Ticking the mod off is the only
 * control it could offer, and the host already has that one. The log line below is for a game where
 * it does not land, which is the one thing a panel could have said that the screen does not.
 *
 * ## GameMaker 8 only
 *
 * `window_set_region_size` is a GameMaker 8 function, and in Studio the drawing region is the
 * application surface -- a different mechanism that would need its own fix.
 */

/** The block these games are drawn on, and so the grid the region has to cover whole. */
const BLOCK = 32;

/** Every view slot GameMaker 8 gives a room. */
const VIEWS = 8;

export default createMod((mod) => {
  if (mod.engine !== "gm8") {
    console.warn("[608] only GameMaker 8 games are supported");
    return;
  }

  /** `value` rounded up to a whole number of blocks, as GML. */
  const upToBlock = (value: string) => `((${value} + ${BLOCK} - 1) div ${BLOCK}) * ${BLOCK}`;

  mod.resource.object.create({
    name: "fit",
    // The last size reported, so a game whose every room needs the same fix logs it once for the
    // whole run rather than once per room change.
    vars: ["sent"],
    events: {
      create: ({ v }) => `${v.sent} = "";`,
      beginStep: ({ v, send }) => `
        var vf_i, vf_grew, vf_was_w, vf_was_h, vf_w, vf_h, vf_rw, vf_rh, vf_ww, vf_wh, vf_msg;

        vf_grew = 0;
        vf_was_w = 0;
        vf_was_h = 0;
        vf_w = 0;
        vf_h = 0;

        if (!view_enabled) {
          // The region is the room. Nothing to round up means nothing to do -- and in particular no
          // view where the game asked for none.
          vf_w = ${upToBlock("room_width")};
          vf_h = ${upToBlock("room_height")};
          if (vf_w == room_width && vf_h == room_height) exit;

          // The other seven first: see the comment at the top about writes past the end.
          for (vf_i = 1; vf_i < ${VIEWS}; vf_i += 1) view_visible[vf_i] = 0;

          // Every field, because what is stored in a view the room never used is stale.
          view_xview[0] = 0;
          view_yview[0] = 0;
          view_wview[0] = vf_w;
          view_hview[0] = vf_h;
          view_xport[0] = 0;
          view_yport[0] = 0;
          view_wport[0] = vf_w;
          view_hport[0] = vf_h;
          view_angle[0] = 0;
          view_object[0] = -1;
          view_visible[0] = 1;
          view_enabled = 1;

          vf_was_w = room_width;
          vf_was_h = room_height;
          vf_grew = 1;
        } else {
          for (vf_i = 0; vf_i < ${VIEWS}; vf_i += 1) {
            if (view_visible[vf_i]) {
              vf_was_w = max(vf_was_w, view_xport[vf_i] + view_wport[vf_i]);
              vf_was_h = max(vf_was_h, view_yport[vf_i] + view_hport[vf_i]);
              if (view_wview[vf_i] == view_wport[vf_i] && (view_wview[vf_i] mod ${BLOCK}) != 0) {
                view_wview[vf_i] = ${upToBlock("view_wview[vf_i]")};
                view_wport[vf_i] = view_wview[vf_i];
                vf_grew = 1;
              }
              if (view_hview[vf_i] == view_hport[vf_i] && (view_hview[vf_i] mod ${BLOCK}) != 0) {
                view_hview[vf_i] = ${upToBlock("view_hview[vf_i]")};
                view_hport[vf_i] = view_hview[vf_i];
                vf_grew = 1;
              }
              vf_w = max(vf_w, view_xport[vf_i] + view_wport[vf_i]);
              vf_h = max(vf_h, view_yport[vf_i] + view_hport[vf_i]);
            }
          }
          if (!vf_grew) exit;
        }

        vf_rw = window_get_region_width();
        vf_rh = window_get_region_height();
        if (vf_rw != vf_w || vf_rh != vf_h) {
          vf_ww = window_get_width();
          vf_wh = window_get_height();
          window_set_region_size(vf_w, vf_h, true);
          // Only when the window *was* the region. Anywhere else -- a fixed scale, fullscreen on an
          // installed copy -- the two differ on purpose and the engine scales between them.
          if (vf_ww == vf_rw && vf_wh == vf_rh) window_set_size(vf_w, vf_h);
        }

        vf_msg = string(vf_was_w) + "x" + string(vf_was_h)
          + " " + string(vf_w) + "x" + string(vf_h);
        if (vf_msg != ${v.sent}) {
          ${v.sent} = vf_msg;
          ${send("grew", "vf_msg")}
        }
      `,
    },
  });

  mod.on("grew", (sizes) => {
    const [from, to] = sizes.split(" ");
    console.log(`[608] ${from} -> ${to}`);
  });
});
