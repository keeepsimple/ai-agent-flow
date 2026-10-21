// The screenshot step of a preview, on its own so it can be tested without
// Chrome. The tool's window gets minimised or shoved off-screen and then
// Chrome answers "Cannot take screenshot with 0 width"; bringing the window
// back and forcing a viewport is what fixes that. Whatever the error, the
// retry is one: a looping screenshot is worse than a missing one.

async function prepare(send, width, height) {
  try {
    const { windowId } = await send('Browser.getWindowForTarget')
    await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', width, height } })
  } catch {
    // Headless, or a Chrome that does not answer for windows: the viewport
    // override below is what matters then.
  }
  try { await send('Page.bringToFront') } catch {}
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
}

export async function captureWith(send, { width = 1280, height = 900 } = {}) {
  await prepare(send, width, height)
  let first
  try {
    return await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  } catch (err) {
    first = err
  }
  await prepare(send, width, height)
  try {
    return await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  } catch (second) {
    throw new Error(`screenshot failed twice: ${first.message} / ${second.message}`)
  }
}
