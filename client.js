/**
 * dsh-pull-to-send — browser half.
 *
 * Goal: press the composer card and pull upward; release to send. One big,
 * low-precision stroke replaces the small send button, and Enter stays free.
 *
 * HOW IT WORKS
 * DSH's composer is a Lexical-owned contenteditable carrying the stable anchors
 * `[data-composer-input]` (editor) and `[data-composer-card]` (the surrounding
 * card, the gesture surface). A document-level `pointerdown` on the card starts
 * tracking. The gesture *arms* only when the pointer crosses the card's top
 * edge going up by ARM_DISTANCE px with an upward-dominant direction — drags
 * that stay inside the card (text selection, caret moves) never arm, so in-card
 * selection keeps 100% native behavior.
 *
 * On arm, a fixed-position clone of the card lifts off from the real rect and
 * follows the pointer with damping (a light lag that reads as weight), growing
 * slightly and casting a deeper shadow as it rises. The real card shrinks and
 * dims beneath it.
 *
 * SENDING
 * Release arms → the current primary action of the send control fires via a
 * plain DOM `.click()`: the idle button (`aria-label` 发送消息 / Send message,
 * claude-style `data-dsh-claude-control="send"`) or its queue/steer variants
 * while a reply is generating. Empty drafts, disabled buttons and missing
 * composers never arm. The click-works-over-React fact was verified with a CDP
 * probe against the live GUI: composer cleared, stop button appeared, user
 * bubble count increased.
 *
 * ANIMATION (FLIP)
 * After the click, the plugin polls (rAF, bounded) for the user bubble the
 * send produced (inside the same conversation pane: the last `userStack` row's
 * `bubble` element — DSH hashes CSS-module class names with a stable semantic
 * suffix). The clone FLIPs into that bubble's rect over FLIP_MS with its
 * transform origin at the bottom-left, the real bubble fades in over the last
 * BUBBLE_LEAD_MS of the flight, the clone fades out just after landing, and the
 * real card returns immediately (RETURN_MS) without waiting for the flight to
 * finish. If no bubble appears within BUBBLE_WAIT_MS, the clone flies to a
 * point just above the composer instead. Cancels fly the clone back along its
 * path in CANCEL_MS.
 *
 * WHY THE LISTENERS ARE IN THE BUBBLE PHASE
 * A capture listener would run before every other handler and could steal
 * presses a component already owns. In the bubble phase,
 * `event.defaultPrevented` is a real signal: anything DSH itself consumed is
 * left alone.
 *
 * GUARDS
 *   - pointer type: only `mouse` (and `pen`) — touch scrolling must never send;
 *   - presses on buttons/links/menus inside the card are left alone;
 *   - an IME composition in flight (`data-composer-composing`) cancels the
 *     gesture instead of firing a half-composed draft;
 *   - Escape or `pointercancel` at any point cancels;
 *   - another editable, the terminal (`.xterm`) and `[inert]` subtrees are
 *     untouched — the gesture starts only on the composer card itself.
 *
 * MULTIPLE CONVERSATION PANES
 * The gesture binds to the card under the pointer, so embedded panes work with
 * no extra bookkeeping; bubble lookup prefers the composer's own pane.
 *
 * Envelope: DSH browser bundles register on the injected
 * `window.__ModuleLoader__` facade keyed by package id; the loader then calls
 * `apply(ctx)` and reads `inject` for service gating.
 */

window.__ModuleLoader__.load({
	id: 'dsh-pull-to-send',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		/** Plugin id, used for effect naming. */
		const PLUGIN_ID = 'dsh-pull-to-send';

		//#region tunables — every knob of v1 lives here, no settings panel

		/** Upward distance past the card's top edge before the gesture arms. */
		const ARM_DISTANCE = 24;
		/** Pointer types allowed to send. Touch is deliberately excluded. */
		const POINTER_TYPES = new Set(['mouse', 'pen']);
		/** Per-frame follow factor of the clone toward the pointer (0..1]. */
		const DAMPING = 0.9;
		/** Clone scale at full lift (starts at 1.0). */
		const MAX_SCALE = 1.02;
		/** Flight time of the send FLIP, in ms (spec: 360–420). */
		const FLIP_MS = 400;
		/** Easing of the send FLIP: fast out, soft landing. */
		const FLIP_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
		/** The real bubble starts fading in this long before the clone lands. */
		const BUBBLE_LEAD_MS = 80;
		/** Fade-in duration of the real bubble. */
		const BUBBLE_FADE_MS = 180;
		/** The clone lingers this long after landing before fading out. */
		const CLONE_HOLD_MS = 60;
		/** Clone fade-out duration after the hold. */
		const CLONE_FADE_MS = 60;
		/** How long to poll for the new bubble before falling back. */
		const BUBBLE_WAIT_MS = 900;
		/** The real card returns in this time, immediately on release. */
		const RETURN_MS = 200;
		/** Cancel flight time back to the card's original rect. */
		const CANCEL_MS = 320;
		/** Cancel easing: decelerate back home. */
		const CANCEL_EASING = 'cubic-bezier(0.3, 0, 0.3, 1)';

		//#endregion

		//#region anchors — verified against the shipped bundles

		/** Composer card; the gesture surface (`InputBar` cardRef). */
		const CARD = '[data-composer-card]';
		/** Lexical composer host. */
		const COMPOSER = '[data-composer-input]';
		/** Per-session conversation body; scopes bubble lookup to a pane. */
		const PANE = '[data-conversation-session]';
		/** Withdrawn subtrees must never start or join a gesture. */
		const INERT = '[inert]';
		/** Controls inside the card that own their own press. */
		const OWN_PRESS = 'button, a, [role="button"], [aria-haspopup]';
		/** Where new user messages render (hashed module classes, stable suffix). */
		const USER_STACK = '[class*="userStack"]';
		const USER_BUBBLE = '[class*="bubble"]';
		/** Chat body used as the fallback flight target. */
		const CHAT_BODY = '[data-conversation-content]';

		/**
		 * Send controls, in priority order. The claude-style primary is the native
		 * button tagged `data-dsh-claude-control="send"`; the aria labels cover the
		 * idle send plus the queue/steer variants shown while generating, in both
		 * shipped locales.
		 */
		const SEND_SELECTORS = [
			'[data-dsh-claude-control="send"]',
			'button[aria-label="发送消息"]',
			'button[aria-label="Send message"]',
			'button[aria-label="排队发送"]',
			'button[aria-label="插话发送"]',
		];

		//#endregion

		/**
		 * First Element on the event's path (shadow-DOM safe).
		 * @param event - a PointerEvent.
		 * @returns the event target element, or null.
		 */
		function elementOf(event) {
			const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
			for (const node of path) if (node instanceof Element) return node;
			return null;
		}

		/**
		 * The composer card under a press. The direct target normally sits inside
		 * the card, but decorative overlays (claude-style paints a mask above the
		 * composer) can be the hit target instead, so fall back to scanning the
		 * full hit stack at the press point for any element inside a card.
		 * @param event - a PointerEvent.
		 * @returns the card element, or null.
		 */
		function cardOf(event) {
			const direct = elementOf(event)?.closest(CARD);
			if (direct !== null && direct !== undefined) return direct;
			if (typeof document.elementsFromPoint !== 'function') return null;
			for (const el of document.elementsFromPoint(event.clientX, event.clientY)) {
				const card = el.closest?.(CARD);
				if (card !== null && card !== undefined) return card;
			}
			return null;
		}

		/** gesture state; null when idle. */
		let gesture = null;

		/**
		 * Is the composer editable, not inert, and laid out?
		 * @param el - candidate composer.
		 * @returns true when the composer can hold a draft.
		 */
		function usable(el) {
			return el instanceof HTMLElement
				&& el.isContentEditable
				&& el.closest(INERT) === null
				&& el.getClientRects().length > 0;
		}

		/**
		 * Current primary send control inside a card.
		 * @param card - the composer card.
		 * @returns the button element, or null.
		 */
		function sendButton(card) {
			for (const selector of SEND_SELECTORS) {
				for (const el of card.querySelectorAll(selector)) {
					if (el instanceof HTMLButtonElement && !el.disabled) return el;
				}
			}
			return null;
		}

		/**
		 * Draft text of a composer (Lexical lives in plain paragraphs).
		 * @param composer - the composer element.
		 * @returns the visible draft text.
		 */
		function draftText(composer) {
			return (composer.textContent ?? '').trim();
		}

		//#region styles

		const STYLE_ID = 'dsh-pull-to-send-style';

		/**
		 * Inject the small stylesheet the animation classes need.
		 * Idempotent: a hot reload reuses the existing tag.
		 */
		function ensureStyle() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement('style');
			style.id = STYLE_ID;
			style.textContent = `
.${STYLE_ID}-card { transition: transform ${RETURN_MS}ms ease, opacity ${RETURN_MS}ms ease; }
.${STYLE_ID}-card-lifted { transform: scale(0.97); opacity: 0.4; }
.${STYLE_ID}-clone { position: fixed; margin: 0 !important; pointer-events: none;
  z-index: 2147483646; will-change: transform, opacity; box-sizing: border-box; }
.${STYLE_ID}-bubble-in { animation: ${STYLE_ID}-fadein ${BUBBLE_FADE_MS}ms ease both; }
@keyframes ${STYLE_ID}-fadein { from { opacity: 0; } to { opacity: 1; } }
`;
			document.head.append(style);
		}

		//#endregion

		//#region flight targets

		/**
		 * Conversation pane that owns a node.
		 * @param node - any element.
		 * @returns the pane element, or null outside a conversation.
		 */
		function paneOf(node) {
			return node instanceof Element ? node.closest(PANE) : null;
		}

		/**
		 * The newest user bubble in a pane.
		 * @param pane - conversation pane, or null for the whole document.
		 * @returns the bubble element, or null.
		 */
		function lastUserBubble(pane) {
			const scope = pane ?? document;
			const stacks = scope.querySelectorAll(USER_STACK);
			const stack = stacks.length > 0 ? stacks[stacks.length - 1] : null;
			if (stack === null) return null;
			return stack.querySelector(USER_BUBBLE) ?? stack;
		}

		/**
		 * Where the clone should land when no bubble can be found: centered just
		 * above the composer (or the chat body bottom), scaled down like a sent
		 * message leaving the input area.
		 * @param cardRect - the card's original rect.
		 * @returns a fallback target rect.
		 */
		function fallbackTarget(cardRect) {
			const chat = document.querySelector(CHAT_BODY);
			const base = chat !== null && chat.getClientRects().length > 0
				? chat.getBoundingClientRect()
				: cardRect;
			return DOMRect.fromRect({ x: base.x + base.width / 2 - 60, y: Math.min(base.bottom - 8, cardRect.y) - 36, width: 120, height: 28 });
		}

		//#endregion

		//#region clone plumbing

		/**
		 * Build the fixed-position clone from a card.
		 * @param card - the card to copy.
		 * @param rect - the rect to pin the clone to.
		 * @returns the clone element.
		 */
		function makeClone(card, rect) {
			const clone = /** @type {HTMLElement} */ (card.cloneNode(true));
			clone.className = `${STYLE_ID}-clone ${card.className}`;
			clone.removeAttribute('data-composer-card');
			for (const el of clone.querySelectorAll('[data-composer-card]')) el.removeAttribute('data-composer-card');
			clone.style.left = `${rect.left}px`;
			clone.style.top = `${rect.top}px`;
			clone.style.width = `${rect.width}px`;
			clone.style.height = `${rect.height}px`;
			clone.style.transform = 'scale(1)';
			clone.style.transformOrigin = 'bottom left';
			clone.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.18)';
			document.documentElement.append(clone);
			return clone;
		}

		/**
		 * Position a clone at a rect with a scale, writing transform only.
		 * @param clone - the clone element.
		 * @param rect - target rect (top-left placement).
		 * @param scale - additional scale.
		 */
		function placeClone(clone, rect, scale) {
			clone.style.left = `${rect.left}px`;
			clone.style.top = `${rect.top}px`;
			clone.style.transform = `scale(${scale})`;
		}

		/**
		 * Deeper shadow as the clone rises.
		 * @param clone - the clone element.
		 * @param progress - 0..1 lift progress.
		 */
		function shadeClone(clone, progress) {
			const y = 8 + 20 * progress;
			const blur = 24 + 28 * progress;
			const alpha = 0.18 + 0.14 * progress;
			clone.style.boxShadow = `0 ${y.toFixed(1)}px ${blur.toFixed(1)}px rgba(0, 0, 0, ${alpha.toFixed(3)})`;
		}

		//#endregion

		//#region gesture lifecycle

		/**
		 * Start tracking a potential pull.
		 * @param event - the pointerdown that started it.
		 */
		function onPress(event) {
			if (event.defaultPrevented || event.button !== 0) return;
			if (!POINTER_TYPES.has(event.pointerType)) return;
			const target = elementOf(event);
			if (target === null) return;
			if (target.closest(OWN_PRESS) !== null) return;
			const card = cardOf(event);
			if (card === null || !(card instanceof HTMLElement)) return;
			if (card.closest(INERT) !== null) return;
			// One gesture at a time: an in-flight animation must not be hijacked.
			if (gesture !== null) return;
			const composer = card.querySelector(COMPOSER);
			if (!usable(composer)) return;
			gesture = {
				card,
				composer,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				grabDx: event.clientX - card.getBoundingClientRect().left,
				grabDy: event.clientY - card.getBoundingClientRect().top,
				rect: card.getBoundingClientRect(),
				armed: false,
				clone: null,
				x: 0, y: 0, scale: 1,
				targetX: 0, targetY: 0,
				raf: 0,
				following: false,
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onRelease);
			window.addEventListener('pointercancel', onCancel);
			window.addEventListener('keydown', onKey);
			window.addEventListener('blur', onCancel);
		}

		/**
		 * Arm the gesture once the pull crosses the card's top edge going up.
		 * @param event - the pointermove.
		 */
		function onMove(event) {
			const g = gesture;
			if (g === null || event.pointerId !== g.pointerId) return;
			const dx = event.clientX - g.startX;
			const dy = event.clientY - g.startY;
			// An IME taking over mid-pull cancels instead of firing a half draft.
			if (g.composer.hasAttribute('data-composer-composing')) { cancelGesture(); return; }
			if (!g.armed) {
				const aboveTop = g.rect.top - event.clientY;
				if (aboveTop < ARM_DISTANCE || dy >= 0 || Math.abs(dy) <= Math.abs(dx)) return;
				const button = sendButton(g.card);
				if (button === null || draftText(g.composer) === '') return;
				arm(g, event.clientX, event.clientY);
			}
			if (g.clone !== null) {
				g.targetX = event.clientX - g.grabDx;
				g.targetY = event.clientY - g.grabDy;
				followLoop(g);
			}
		}

		/**
		 * Lift the clone off the card.
		 * @param g - the gesture.
		 * @param x - pointer x.
		 * @param y - pointer y.
		 */
		function arm(g, x, y) {
			g.armed = true;
			ensureStyle();
			g.clone = makeClone(g.card, g.rect);
			g.card.classList.add(`${STYLE_ID}-card`, `${STYLE_ID}-card-lifted`);
			g.x = x - g.grabDx;
			g.y = y - g.grabDy;
			g.targetX = g.x;
			g.targetY = g.y;
			g.following = true;
			followLoop(g);
		}

		/**
		 * Damped follow loop: the clone eases toward the pointer each frame.
		 * @param g - the gesture.
		 */
		function followLoop(g) {
			if (g.raf !== 0 || g.clone === null) return;
			const step = () => {
				g.raf = 0;
				if (g.clone === null) return;
				g.x += (g.targetX - g.x) * DAMPING;
				g.y += (g.targetY - g.y) * DAMPING;
				const rise = Math.max(0, g.rect.top - g.y);
				const progress = Math.min(1, rise / (ARM_DISTANCE * 6));
				g.scale = 1 + (MAX_SCALE - 1) * progress;
				placeClone(g.clone, DOMRect.fromRect({ x: g.x, y: g.y, width: g.rect.width, height: g.rect.height }), g.scale);
				shadeClone(g.clone, progress);
				if (g.following && (Math.abs(g.targetX - g.x) > 0.1 || Math.abs(g.targetY - g.y) > 0.1)) {
					g.raf = requestAnimationFrame(step);
				}
			};
			g.raf = requestAnimationFrame(step);
		}

		/**
		 * Release: send when armed, otherwise quietly reset.
		 * @param event - the pointerup.
		 */
		function onRelease(event) {
			const g = gesture;
			if (g === null || event.pointerId !== g.pointerId) return;
			detach();
			if (g.armed && g.clone !== null) {
				const button = sendButton(g.card);
				if (button !== null && draftText(g.composer) !== '') {
					send(g, button);
					return;
				}
			}
			if (g.armed && g.clone !== null) flyBack(g);
		}

		/**
		 * Pointercancel / window blur: always cancel.
		 */
		function onCancel() {
			if (gesture !== null) cancelGesture();
		}

		/**
		 * Escape cancels a live gesture.
		 * @param event - the keydown.
		 */
		function onKey(event) {
			if (event.key === 'Escape' && gesture !== null) cancelGesture();
		}

		/** Stop tracking window events. */
		function detach() {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onRelease);
			window.removeEventListener('pointercancel', onCancel);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('blur', onCancel);
		}

		/**
		 * Fire the send and fly the clone into the new bubble.
		 * @param g - the gesture.
		 * @param button - the send control to click.
		 */
		function send(g, button) {
			gesture = null;
			// The real card returns immediately; it does not wait for the flight.
			g.card.classList.remove(`${STYLE_ID}-card-lifted`);
			window.setTimeout(() => g.card.classList.remove(`${STYLE_ID}-card`), RETURN_MS);
			button.click();
			const clone = g.clone;
			clone.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASING}, opacity ${CLONE_FADE_MS}ms ease ${FLIP_MS + CLONE_HOLD_MS}ms`;
			const pane = paneOf(g.card);
			// Only a bubble that did not exist before the click may be the target.
			const before = lastUserBubble(pane);
			const deadline = performance.now() + BUBBLE_WAIT_MS;
			const poll = () => {
				const bubble = lastUserBubble(pane);
				if (bubble instanceof HTMLElement && bubble !== before && bubble.getClientRects().length > 0) {
					flyToBubble(g, clone, bubble);
					return;
				}
				if (performance.now() < deadline) {
					requestAnimationFrame(poll);
					return;
				}
				flyToRect(g, clone, fallbackTarget(g.rect));
			};
			requestAnimationFrame(poll);
		}

		/**
		 * FLIP the clone into a real bubble: fly, crossfade, clean up.
		 * @param g - the gesture.
		 * @param clone - the flying clone.
		 * @param bubble - the bubble element that appeared.
		 */
		function flyToBubble(g, clone, bubble) {
			const rect = bubble.getBoundingClientRect();
			flyToRect(g, clone, rect, () => {
				bubble.classList.add(`${STYLE_ID}-bubble-in`);
				window.setTimeout(() => bubble.classList.remove(`${STYLE_ID}-bubble-in`), BUBBLE_FADE_MS);
			});
		}

		/**
		 * Fly the clone into a target rect and fade it out after landing.
		 * @param g - the gesture.
		 * @param clone - the flying clone.
		 * @param rect - destination rect.
		 * @param nearEnd - called FLIP_MS - BUBBLE_LEAD_MS after takeoff.
		 */
		function flyToRect(g, clone, rect, nearEnd) {
			const scale = Math.min(rect.width / g.rect.width, rect.height / g.rect.height) || 0.4;
			placeClone(clone, rect, Math.max(scale, 0.2));
			if (typeof nearEnd === 'function') {
				window.setTimeout(nearEnd, Math.max(0, FLIP_MS - BUBBLE_LEAD_MS));
			}
			window.setTimeout(() => { clone.style.opacity = '0'; }, FLIP_MS + CLONE_HOLD_MS);
			window.setTimeout(() => clone.remove(), FLIP_MS + CLONE_HOLD_MS + CLONE_FADE_MS);
		}

		/**
		 * Cancel: fly the clone home along its path, then destroy it.
		 * @param g - the gesture.
		 */
		function flyBack(g) {
			gesture = null;
			g.following = false;
			if (g.raf !== 0) cancelAnimationFrame(g.raf);
			const clone = g.clone;
			clone.style.transition = `left ${CANCEL_MS}ms ${CANCEL_EASING}, top ${CANCEL_MS}ms ${CANCEL_EASING}, transform ${CANCEL_MS}ms ${CANCEL_EASING}`;
			g.card.classList.remove(`${STYLE_ID}-card-lifted`);
			window.setTimeout(() => g.card.classList.remove(`${STYLE_ID}-card`), CANCEL_MS);
			placeClone(clone, g.rect, 1);
			shadeClone(clone, 0);
			window.setTimeout(() => clone.remove(), CANCEL_MS);
		}

		/**
		 * Cancel from any state, with or without a clone.
		 */
		function cancelGesture() {
			const g = gesture;
			if (g === null) return;
			detach();
			gesture = null;
			if (g.raf !== 0) cancelAnimationFrame(g.raf);
			if (g.clone !== null) {
				g.following = false;
				g.clone.style.transition = `left ${CANCEL_MS}ms ${CANCEL_EASING}, top ${CANCEL_MS}ms ${CANCEL_EASING}, transform ${CANCEL_MS}ms ${CANCEL_EASING}`;
				placeClone(g.clone, g.rect, 1);
				window.setTimeout(() => g.clone?.remove(), CANCEL_MS);
			}
			g.card.classList.remove(`${STYLE_ID}-card`, `${STYLE_ID}-card-lifted`);
		}

		//#endregion

		/**
		 * Install the listeners; `ctx.effect` removes them again on unload and
		 * re-runs on hot reload, so iterations never stack duplicates.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(
				() => {
					ensureStyle();
					document.addEventListener('pointerdown', onPress);
					return () => {
						document.removeEventListener('pointerdown', onPress);
						if (gesture !== null) cancelGesture();
					};
				},
				PLUGIN_ID + ': pull-to-send',
			);
		}

		exports.apply = apply;
		/** No Cordis services are required. */
		exports.inject = [];
		return module.exports;
	},
});
