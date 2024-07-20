import {Glob} from 'bun'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {parseArgs} from 'util'
import {
	localTrackToTrack,
	setupDatabase,
	downloadTrack,
	toFilename,
} from '../utils.ts'
import {LocalTrack} from '../schema'

/**
  We work with the tracks across three different layers:
   - Local file system:
   - Local SQLite database: Track
   - Remote PostgreSQL (supabase) schema: RemoteTrack
*/

// 1. Get CLI arguments (only strings + booleans)
const {values} = parseArgs({
	args: Bun.argv,
	options: {
		slug: {
			type: 'string',
		},
		limit: {
			type: 'string',
			default: '4000',
		},
		folder: {
			type: 'string',
		},
		includeFailed: {
			type: 'boolean',
		},
		force: {
			type: 'boolean',
		},
		debug: {
			type: 'boolean',
		},
		deleteDuplicates: {
			type: 'boolean',
		},
		pull: {
			type: 'boolean',
		},
	},
	strict: true,
	allowPositionals: true,
})
if (!values.slug) throw Error('Pass in `--slug <my-radio>` to select your channel')
if (!values.folder) throw Error('Pass in `--folder <path>` to decide where to store your radio')
const slug = values.slug
const limit = Number(values.limit)
const folder = `${values.folder}/${values.slug}`
const databasePath = `${folder}/${slug}.sqlite`

console.log('START:', slug, limit, databasePath)
console.time('STOP')

await mkdir(folder, {recursive: true})
const db = await setupDatabase(databasePath)

const localTracks = db
	.query(`select * from tracks`)
	.all()
	.map(localTrackToTrack)
	.filter((x) => x)
console.log(localTracks.length, 'local tracks')

// // Fetch remote tracks into tracks.
// const { data, error } = await fetchRemoteTracks(slug, limit)
// if (error) throw Error(`Failed to fetch remote tracks: ${error.message}`)
// const remoteTracks = data.map(remoteTrackToTrack).filter((x) => x)
// console.log('Fetched', remoteTracks.length, 'remote tracks')
// if (data.length - remoteTracks.length > 0) {
//   console.log(data.length - remoteTracks.length, 'track(s) failed to parse')
// }

// // Check if there are remote tracks to pull.
// const localIds = new Set(localTracks.map((t) => t.id))
// const newRemoteTracks = remoteTracks.filter((track) => !localIds.has(track.id))
// if (newRemoteTracks.length) {
//   console.log(newRemoteTracks.length, 'new remote tracks to pull. Run --pull to do it')
//   if (values.pull) {
//     newRemoteTracks.forEach((t) => upsertLocalTrack(db, t))
//     console.log('Done pulling')
//   }
// } else {
//   console.log('Nothing to pull')
// }

// // Check if there are local tracks to push.
// const remoteIds = new Set(remoteTracks.map((t) => t.id))
// const newLocalTracks = localTracks.filter((track) => !remoteIds.has(track.id))
// if (newLocalTracks.length) {
//   console.log(newLocalTracks.length, 'tracks to push')
// } else {
//   console.log('Nothing to push')
// }

// Things we could do now.
// - Check remote tracks that could not be pulled
// - Check local tracks without files
// - Check local tracks with lastError

const tracksFolder = `${folder}/tracks`
const glob = new Glob(`${tracksFolder}/*.m4a`)
const filesDownloaded = await Array.fromAsync(glob.scan('.'))
console.log(filesDownloaded.length, 'files on disk')

const whatnow = db.query(`select id, title, files, lastError from tracks where files != ''`).all()
console.log(whatnow.length, 'tracks with files')

const errors = db.query(`select id, title, files, lastError from tracks where lastError != ''`).all()
console.log(errors.length, 'tracks with errors')

const tracksWithEmptyFiles = db.query(`select * from tracks where files = '' and lastError = ''`).all() as LocalTrack[]
console.log(tracksWithEmptyFiles.length, `tracks  to download (e.g. tracks without files and error)`)

// tracksWithEmptyFiles.forEach((track) => downloadTrack(track, tracksFolder, db))
for (const track of tracksWithEmptyFiles) {
	await downloadTrack(track, tracksFolder, db)
}

const q123 = db.query(`select * from tracks where lastError is null`).all() as LocalTrack[]
console.log(q123.length, 'tracks without errors')

// Compare remote tracks with local files. Why actually? Can't we just check the sqlite? Or is the filesystem the real database :smirk:
// const filesWithSameProviderId = []
// for await (const file of glob.scan('.')) {
// 	if (t.providerId && file.includes(t.providerId)) {
// 		filesWithSameProviderId.push(file)
// 	}
// }
// t.files = JSON.stringify(filesWithSameProviderId)
// upsertLocalTrack(db, t)

// const fileExists = filesWithSameProviderId.length > 0
// if (!values.force && fileExists) continue

const q = db.query('update tracks set files = $files where id = $id')
for (const track of q123) {
	const filename = track.files || toFilename(track, tracksFolder)
	const exists = existsSync(filename)
	if (exists) {
		// console.log('skipping existing track')
		continue
	}
	console.log('doesnt exist', filename)
	// console.log(filesDownloaded.filter(x => x.includes(track.providerId)))
	// await downloadTrack(track, filename, db)
}

console.timeEnd('STOP')
// process.exit(0)
