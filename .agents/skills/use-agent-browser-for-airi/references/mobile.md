# Mobile browser coverage

## Browser-driven mobile layout

Run the web host on a dedicated loopback port:

```bash
pnpm -F @proj-airi/stage-web dev --host 127.0.0.1 --port 5174
agent-browser --session airi-mobile-web open http://127.0.0.1:5174/settings/models
```

Set a desktop-width viewport while operating the settings page if controls are present in the DOM but visually outside the compact layout:

```bash
agent-browser set viewport 768 1024
```

Follow the shared import contract. After `Pick`, switch to the intended phone viewport before opening the stage and capturing evidence:

```bash
agent-browser set viewport 390 844
agent-browser open http://127.0.0.1:5174/
agent-browser wait 'canvas'
agent-browser screenshot
```

This validates the web host's shared Vue UI and mobile responsive renderer. It does not validate native mobile behavior. The native mobile host was retired; use the web runtime for phone viewport coverage.
