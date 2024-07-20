import {Glob} from 'bun'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {parseArgs} from 'util'
import {
	localTrackToTrack,
	setupDatabase,
	fetchRemoteTracks,
	downloadTrack,
	toFilename,
	remoteTrackToTrack,
	upsertLocalTrack,
	trackToLocalTrack,
} from '../utils.ts'
import type {LocalTrack, Track} from '../schema'

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

		retryFailed: {
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
		download: {
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
const tracksFolder = `${folder}/tracks`

console.log('START:', slug, limit, databasePath)
console.time('STOP')
await mkdir(tracksFolder, {recursive: true})
const db = await setupDatabase(databasePath)

function getTracks(): Track[] {
	const query = db.query(`select * from tracks`)
	const localTracks = query.all() as LocalTrack[]
	const tracks = localTracks
		.map(localTrackToTrack)
		.filter((x) => x !== null)
		.filter((x) => x)
	return tracks
}

const glob = new Glob(`${tracksFolder}/*.m4a`)
const localFiles = await Array.fromAsync(glob.scan('.'))

const tracks = getTracks()
console.log(tracks.length, 'local tracks')
console.log(tracks.filter((t) => t.files).length, 'tracks with file')
console.log(localFiles.length, 'local files')
console.log(tracks.filter((t) => t.lastError).length, 'tracks with error')
console.log(tracks.filter((t) => !t.files).length, 'tracks without file')
console.log(tracks.filter((t) => !t.files && !t.lastError).length, 'tracks without file and error')

// Fetch remote tracks
const {data, error} = await fetchRemoteTracks(slug, limit)
if (error) throw Error(`Failed to fetch remote tracks: ${error.message}`)
const remoteTracks = data.map(remoteTrackToTrack).filter((x) => x)
console.log('Fetched', remoteTracks.length, 'remote tracks')
if (data.length - remoteTracks.length > 0) {
	console.log(data.length - remoteTracks.length, 'track(s) failed to parse')
}

// Check if there are remote tracks to pull.
const localIds = new Set(tracks.map((t) => t.id))
const newRemoteTracks = remoteTracks.filter((track) => !localIds.has(track.id))
if (newRemoteTracks.length) {
	console.log(newRemoteTracks.length, 'remote tracks to pull. Run --pull')
	if (values.pull) {
		newRemoteTracks.forEach((t) => upsertLocalTrack(db, t))
		console.log('Done pulling')
	}
} else {
	console.log('Nothing to pull')
}

const list = getTracks()
	.slice(0, limit)
	.filter((track) => {
		const filename = toFilename(track, tracksFolder)
		const exists = existsSync(filename)
		if (exists && !track.files) {
			console.log('Found existing track', track.id)
			db.query('update tracks set files = ? where id = ?').run(filename, track.id)
		}
		return !exists
	})
	.filter((track) => (values.retryFailed ? true : !track.lastError))

if (list.length && values.download) {
	console.log('Downloading', list.length, 'tracks. It will take around', list.length * 4, 'seconds. See ya')
	let current = 0
	for (const track of list) {
		current++
		const progress = `${current}/${list.length}`
		const filename = toFilename(track, tracksFolder)
		console.log(progress, track.lastError, filename)
		await downloadTrack(track, filename, db)
	}
	console.log(
		getTracks()
			.slice(0, limit)
			.filter((x) => x.lastError).length,
		'tracks failed to download. Use --retryFailed to try again',
	)
} else {
	if (!values.download) {
		console.log('Use --download to download your tracks')
	}
}

// // Check if there are local tracks to push.
// const remoteIds = new Set(remoteTracks.map((t) => t.id))
// const newLocalTracks = getTracks().filter((track) => !remoteIds.has(track.id))
// if (newLocalTracks.length) {
//   console.log(newLocalTracks.length, 'tracks to push')
// } else {
//   console.log('Nothing to push')
// }

console.timeEnd('STOP')
// process.exit(0)
