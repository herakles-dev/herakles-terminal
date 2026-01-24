# Music Player Resume Issue - Debug Investigation

## Problem
Video does not persist/resume after page refresh.

## 5 Whys Investigation

### Why #1: Is the state being saved to the server?
**Check:** Browser console for `[MusicSync]` logs when loading a video.
- Should see: `[MusicSync] Syncing state: {"videoId":"xxx"...} immediate: true`
- Should see: `[MusicSync] Save response: {"data":{"success":true}}`

**Server check:** Look for `[MusicAPI] PUT /state` in server logs.

### Why #2: Is the API endpoint being called on refresh?
**Check:** Browser console for `[MusicResume]` logs on page load.
- Should see: `[MusicResume] Fetching saved state...`
- Should see: `[MusicResume] Got response: {...}`

### Why #3: Is the state being loaded correctly?
**Check:** What does the response contain?
- If `[MusicResume] No videoId found in response` → data not saved or wrong user
- If `[MusicResume] Restoring video: xxx` → data is loading

**Server check:** Look for `[MusicAPI] GET /state` - does it return videoId?

### Why #4: Is the loaded state reaching MusicPlayer component?
**Check:** After seeing "Restoring video" log, does the player appear?
- If player doesn't show: Check `mode` value in response
- Player only shows if `mode !== 'hidden'`

### Why #5: Is the video actually loading from state?
**Check:** Does the YouTube player load the video and seek to currentTime?
- The `MusicPlayerContent.tsx` should call `loadVideoById(videoId, currentTime)`

## Debug Logs Added

### Client-side (App.tsx)
```
[MusicResume] Fetching saved state...
[MusicResume] Got response: {...}
[MusicResume] Restoring video: xxx at time: 123
[MusicResume] Setting player visible, mode was: video
[MusicSync] Syncing state: {...} immediate: true/false
[MusicSync] Save response: {...}
```

### Server-side (musicRoutes.ts)
```
[MusicAPI] GET /state for user: xxx
[MusicAPI] Returning state: {videoId, currentTime, mode}
[MusicAPI] PUT /state for user: xxx body: {...}
```

## Common Issues

1. **Auth mismatch**: User email differs between save and load
2. **Mode not saved**: If mode='hidden', player won't show on refresh
3. **CSRF token missing**: PUT requests may fail without token
4. **initialState not syncing**: React state not updating from props after mount

## Test Steps
1. Open browser DevTools console
2. Load a video in music player
3. Check for `[MusicSync]` logs confirming save
4. Refresh page
5. Check for `[MusicResume]` logs showing load
6. Verify video loads at saved position
