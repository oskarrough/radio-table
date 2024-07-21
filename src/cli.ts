/* eslint-env node */

import {Glob} from 'bun'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {parseArgs} from 'util'

import {toFilename, fetchRemoteTracks, remoteTrackToTrack} from './utils.ts'
import {setupDatabase, getTracks, upsertTrack} from './database.ts'
import {downloadTrack} from './utils-node.ts'
// import type {LocalTrack, Track} from './schema.ts'
import pLimit from 'p-limit'

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
if (!values.slug) console.log('Pass in `--slug <my-radio>` to select your channel')
if (!values.folder) console.log('Pass in `--folder <path>` to decide where to store your radio')
if (!values.slug || !values.folder) process.exit(1)
const slug = values.slug
const limit = Number(values.limit)
const folder = `${values.folder}/${values.slug}`
const databasePath = `${folder}/${slug}.sqlite`
const tracksFolder = `${folder}/tracks`

console.log('START:', slug, limit, databasePath)
console.time('STOP')
await mkdir(tracksFolder, {recursive: true})
const db = await setupDatabase(databasePath)

const glob = new Glob(`${tracksFolder}/*.m4a`)
const localFiles = await Array.fromAsync(glob.scan('.'))

const tracks = getTracks(db)
console.log(tracks.length, 'tracks')
console.log(tracks.filter((t) => t.lastError).length, 'errors')
// console.log(tracks.filter((t) => t.files).length, 'tracks with file')
console.log(localFiles.length, 'files')
// console.log(tracks.filter((t) => !t.files).length, 'tracks without file')
// console.log(tracks.filter((t) => !t.files && !t.lastError).length, 'tracks without file and error')

// Fetch remote tracks
const {data, error} = await fetchRemoteTracks(slug, limit)
if (error) throw Error(`remote: Failed to fetch tracks: ${error.message}`)
const remoteTracks = data.map(remoteTrackToTrack).filter((x) => x !== null)
console.log(remoteTracks.length, 'Radio4000 tracks')
if (data.length - remoteTracks.length > 0) {
	console.log('remote:', data.length - remoteTracks.length, 'track(s) failed to parse')
}

// Check if there are remote tracks to pull.
const localIds = new Set(tracks.map((t) => t.id))
const newRemoteTracks = remoteTracks.filter((track) => !localIds.has(track.id))
if (newRemoteTracks.length) {
	console.log(newRemoteTracks.length, 'remote tracks to pull. Run --pull')
	if (values.pull) {
		newRemoteTracks.forEach((t) => {
			upsertTrack(db, t)
		})
		console.log('Done pulling')
	}
} else {
	// console.log('Nothing to pull')
}

if (values.download) {
	const list = getTracks(db)
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
	if (list.length) {
		console.log('Downloading', list.length, 'tracks. It will take around', list.length * 4, 'seconds. See ya')

		const limiter = pLimit(5)
		const input = list.map((track, index) =>
			limiter(() => downloadTrack(track, toFilename(track, tracksFolder), db).then(() => console.log(list.length - index))),
		)
		const result = await Promise.all(input)
		console.log(result)

		// let current = 0
		// for (const track of list) {
		// 	current++
		// 	const progress = `${current}/${list.length}`
		// 	const filename = toFilename(track, tracksFolder)
		// 	console.log(progress, filename)
		// 	await downloadTrack(track, filename, db)
		// }
		console.log(
			getTracks(db)
				.slice(0, limit)
				.filter((x) => x.lastError).length,
			'tracks failed to download. Use --retryFailed to try again',
		)
	}
} else {
	if (!values.download) {
		const toDownload = getTracks(db).filter((t) => !t.lastError && !t.files)
		console.log('Use --download for', toDownload.length, 'missing files')
		const q2 = getTracks(db).filter((t) => t.lastError)
		console.log('Use --download --retryFailed to include', q2.length, 'files that previously failed')
	}
}

/*
↓
↑
 */

await Bun.write(`${folder}/${slug}.json`, JSON.stringify({tracks: getTracks(db)}, null, 2))

console.timeEnd('STOP')
// process.exit(0)
