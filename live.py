"""One headless browser the viewer drives: JPEG frames go out, mouse and keys come in.

Playwright's async API runs on its own event loop thread, because the CDP screencast
needs its acks answered while HTTP requests arrive on other threads.
"""
import asyncio
import base64
import threading
import time

from playwright.async_api import async_playwright

MOUSE_TYPES = {"move": "mouseMoved", "down": "mousePressed", "up": "mouseReleased"}
BUTTON_MASKS = {"left": 1, "right": 2, "middle": 4}
MAX_HEIGHT = 16000


class LiveError(Exception):
    pass


class LiveBrowser:
    def __init__(self, capture_js):
        self.capture_js = capture_js
        self.loop = None
        self.start_lock = threading.Lock()
        self.frames = threading.Condition()
        self.frame = None
        self.seq = 0
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        self.cdp = None
        self.size = (1440, 900)
        self.scroll = (0, 0)
        self.last_used = 0

    @property
    def running(self):
        return self.page is not None and not self.page.is_closed()

    def call(self, coroutine, timeout=45):
        self.last_used = time.time()
        return asyncio.run_coroutine_threadsafe(coroutine, self.loop).result(timeout)

    def start(self, width, height):
        with self.start_lock:
            if self.loop is None:
                self.loop = asyncio.new_event_loop()
                threading.Thread(target=self.loop.run_forever, daemon=True).start()
            if not self.running:
                self.call(self._start(width, height), 60)

    def stop(self):
        if self.running:
            self.call(self._stop(), 15)

    async def _start(self, width, height):
        self.size = (width, height)
        self.playwright = await async_playwright().start()
        failure = None
        for channel in ("msedge", "chrome"):
            try:
                self.browser = await self.playwright.chromium.launch(channel=channel, headless=True)
                break
            except Exception as error:
                failure = error
        if self.browser is None:
            raise LiveError(f"Could not start Edge or Chrome: {failure}")
        self.context = await self.browser.new_context(
            viewport={"width": width, "height": height}, device_scale_factor=1)
        self.page = await self.context.new_page()
        self.context.on("page", self._on_popup)
        self.cdp = await self.context.new_cdp_session(self.page)
        self.cdp.on("Page.screencastFrame", self._on_frame)
        await self._screencast()

    async def _stop(self):
        page, self.page = self.page, None
        with self.frames:
            self.frame = None
            self.frames.notify_all()
        await self.browser.close()
        await self.playwright.stop()
        self.browser = self.playwright = self.context = self.cdp = None
        del page

    async def _screencast(self):
        width, height = self.size
        await self.cdp.send("Page.startScreencast", {
            "format": "jpeg", "quality": 72, "maxWidth": width, "maxHeight": height, "everyNthFrame": 1,
        })

    def _on_frame(self, params):
        meta = params.get("metadata", {})
        self.scroll = (meta.get("scrollOffsetX", 0), meta.get("scrollOffsetY", 0))
        with self.frames:
            self.frame = base64.b64decode(params["data"])
            self.seq += 1
            self.frames.notify_all()
        asyncio.ensure_future(self._ack(params["sessionId"]))

    async def _ack(self, session_id):
        try:
            await self.cdp.send("Page.screencastFrameAck", {"sessionId": session_id})
        except Exception:
            pass

    async def _on_popup(self, popup):
        # The tool shows one page, so a link that opens a new tab opens here instead.
        if popup is self.page:
            return
        try:
            await popup.wait_for_load_state("commit", timeout=5000)
        except Exception:
            pass
        url = popup.url
        await popup.close()
        if url and url != "about:blank":
            await self.page.goto(url, wait_until="commit")

    def next_frame(self, seen, timeout=10):
        """Blocks until a frame newer than `seen` exists; returns (bytes or None, seq)."""
        with self.frames:
            if self.seq == seen:
                self.frames.wait(timeout)
            self.last_used = time.time()
            return (self.frame if self.seq != seen else None), self.seq

    def state(self):
        if not self.running:
            return {"running": False}
        return {
            "running": True,
            "url": self.page.url,
            "width": self.size[0],
            "height": self.size[1],
            "scroll": self.scroll,
            "seq": self.seq,
        }

    def go(self, action, url=None):
        self.call(self._go(action, url))

    async def _go(self, action, url):
        try:
            if action == "goto":
                await self.page.goto(url, wait_until="commit", timeout=30000)
            elif action == "back":
                await self.page.go_back(wait_until="commit", timeout=30000)
            elif action == "forward":
                await self.page.go_forward(wait_until="commit", timeout=30000)
            elif action == "reload":
                await self.page.reload(wait_until="commit", timeout=30000)
        except Exception as error:
            raise LiveError(f"Could not load the page: {str(error).splitlines()[0]}")

    def resize(self, width, height):
        self.call(self._resize(width, height))

    async def _resize(self, width, height):
        self.size = (width, height)
        await self.page.set_viewport_size({"width": width, "height": height})
        await self.cdp.send("Page.stopScreencast")
        await self._screencast()

    def send_input(self, events):
        self.call(self._input(events), 15)

    async def _input(self, events):
        for event in events:
            kind = event.get("t")
            modifiers = event.get("mods", 0)
            if kind in MOUSE_TYPES:
                button = event.get("button", "none")
                await self.cdp.send("Input.dispatchMouseEvent", {
                    "type": MOUSE_TYPES[kind], "x": event["x"], "y": event["y"], "button": button,
                    "buttons": event.get("buttons", BUTTON_MASKS.get(button, 0)),
                    "clickCount": event.get("count", 0), "modifiers": modifiers,
                })
            elif kind == "wheel":
                await self.cdp.send("Input.dispatchMouseEvent", {
                    "type": "mouseWheel", "x": event["x"], "y": event["y"],
                    "deltaX": event.get("dx", 0), "deltaY": event.get("dy", 0), "modifiers": modifiers,
                })
            elif kind in ("keydown", "keyup"):
                params = {
                    "type": "keyDown" if kind == "keydown" else "keyUp",
                    "key": event.get("key", ""), "code": event.get("code", ""),
                    "windowsVirtualKeyCode": event.get("keyCode", 0), "modifiers": modifiers,
                }
                if kind == "keydown" and event.get("text"):
                    params["text"] = event["text"]
                if kind == "keydown" and event.get("commands"):
                    params["commands"] = event["commands"]
                await self.cdp.send("Input.dispatchKeyEvent", params)
            elif kind == "text":
                await self.cdp.send("Input.insertText", {"text": event.get("text", "")})

    def capture(self, full):
        return self.call(self._capture(full), 60)

    async def _capture(self, full):
        page = self.page
        seq = self.seq
        info = await page.evaluate(
            "() => ({x: scrollX, y: scrollY, height: document.documentElement.scrollHeight, title: document.title})")
        text = await page.evaluate(self.capture_js, full)
        options = {"type": "jpeg", "quality": 90}
        if full and info["height"] <= MAX_HEIGHT:
            options["full_page"] = True
        elif full:
            options["clip"] = {"x": 0, "y": 0, "width": self.size[0], "height": MAX_HEIGHT}
        image = await page.screenshot(**options)
        return {
            "image": image, "seq": seq, "url": page.url, "title": info["title"], "text": text,
            "scroll": [0, 0] if full else [info["x"], info["y"]],
            "truncated": full and info["height"] > MAX_HEIGHT,
        }
