Voice files for THE FALL go here (pictures are one folder up): one MP3 per radio line, named `<beat id>.mp3` (for example `tf-m01-start.mp3`).
The lines, speakers and file names are in `docs/campaign/the-fall-voice-script.csv`. After adding files run `npm run campaign:voice`
and commit the updated `src/campaign/voice-manifest.ts`; the game only plays files listed there.
