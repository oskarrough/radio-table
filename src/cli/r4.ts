import {$, Glob, ShellError} from 'bun'
import {Database} from 'bun:sqlite'
import {mkdir} from 'node:fs/promises'
import {parseArgs} from 'util'
import filenamify from 'filenamify/browser'
import {createBackup} from '../utils.ts'
import {TrackTableSchema, type Track} from '../schema'

/**
	We work with the tracks across three different layers:
	 - Local file system:
	 - Local SQLite database: Track
	 - Remote PostgreSQL (supabase) schema: TrackR4
*/

/** Downloads the audio from a URL (supported by yt-dlp) */
async function downloadAudio(url: string, filepath: string, metadataDescription: string) {
	return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet --progress ${url}`
}

/** Set up (or reuse) a local sqlite database */
async function setupDatabase(filename: string) {
	const db = new Database(filename, {
		strict: true,
	})
	db.exec('PRAGMA journal_mode = WAL;')
	db.run(TrackTableSchema)
	return db
}

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
	},
	strict: true,
	allowPositionals: true,
})
if (!values.slug) throw Error('Pass in `--slug <my-radio>` to select your channel')
if (!values.folder) throw Error('Pass in `--folder <path>` to decide where to store your radio')
const slug = values.slug
const limit = Number(values.limit)
const folder = `${values.folder}/${values.slug}`

await mkdir(folder, {recursive: true})
const db = await setupDatabase(`${folder}/${slug}.sqlite`)
console.log('status', slug, folder, limit)
const localTracks = db.query(`select * from tracks `).all()
console.log('local tracks', localTracks.length)

// 2. Pull remote to local
const {data, error} = await createBackup(slug, limit)
if (error || !data) {
	console.error('Please migrate the radio to v2 before using this tool')
	process.exit(0)
}
await Bun.write(`${folder}/${slug}.json`, JSON.stringify(data, null, 2))

const remoteTracks = data.tracks
console.log('remote tracks', remoteTracks.length)
console.log(remoteTracks.length - localTracks.length, 'tracks to pull')

// 4. Re-use local data, if we already processed some of the remote tracks.
const tracks = data.tracks.map((t) => {
	const q = db.query('select files, last_error as lastError from tracks where id = $id;')
	const row = q.get({id: t.id}) as Track
	return {...t, files: row?.files, lastError: row?.lastError}
}) as Track[]

// 5. Just some logging
// const localDuplicates = db.query('select count(id) from tracks where json_array_length(files) > 1')
console.log(`Downloading ${data.radio.name} to ${values.folder}/${values.slug}`, {
	localTracks: db.query(`select count() from tracks`).values()[0][0],
	localErrors: db.query('select count() from tracks where last_error is not null').values()[0][0],
	// localDuplicates: localDuplicates.values()[0][0],
	remoteTracksQueried: tracks.length,
	// missingTracks: tracks.length - Number(localTracks.values()[0][0]),
})

// if (values.deleteDuplicates) {
// 	const tracks = db.query('select id, file from tracks where json_array_length(files) > 1').all()
// 	for (const item of tracks) {
// 		try {
// 			console.log('Deleting', item)
// 			await unlink('./' + item.file)
// 		} catch (err) {
// 			console.error('Failed to delete duplicate:', item.file, err)
// 		} finally {
// 			db.query('delete from tracks where id = $id').run({id: item.id})
// 		}
// 	}
// 	console.log(`Deleted ${items.length} duplicate tracks`)
// 	return
// }

const tracksWithError = tracks.filter((t) => t.lastError)
const filteredTracks = values.includeFailed ? tracks : tracks.filter((t) => !t.lastError)

if (values.debug) {
	console.log('Exiting because debug flag is set')
	process.exit(0)
}

if (!values.includeFailed) {
	console.log(
		`Processing ${filteredTracks.length} tracks (ignoring ${tracksWithError.length} previously unavailable tracks, use --includeFailed to include them)`,
	)
} else {
	console.log(`Processing ${filteredTracks.length} tracks`)
}

const tracksFolder = `${folder}/tracks/`
const glob = new Glob(`${tracksFolder}/*.m4a`)

let current = 0
for await (const t of filteredTracks) {
	current++
	const indexLog = `${current}/${filteredTracks.length}`

	// Compare remote tracks with local files. Why actually? Can't we just check the sqlite? Or is the filesystem the real database :smirk:
	const filesWithSameProviderId = []
	for await (const file of glob.scan('.')) {
		if (t.providerId && file.includes(t.providerId)) {
			filesWithSameProviderId.push(file)
		}
	}
	t.files = JSON.stringify(filesWithSameProviderId)
	db.query(
		`INSERT OR REPLACE INTO tracks (id, slug, created_at, updated_at, title, url, discogs_url, description, tags, mentions, provider, provider_id, files, last_error) VALUES ($id, $slug, $created_at, $updated_at, $title, $url, $discogs_url, $description, $tags, $mentions, $provider, $providerId, $files, $lastError);`,
	).run({
		...t,
	})

	const fileExists = filesWithSameProviderId.length > 0
	if (!values.force && fileExists) continue

	try {
		const cleanTitle = filenamify(t.title, {replacement: ' ', maxLength: 255})
		const filename = `${tracksFolder}/${cleanTitle} [${t.providerId}]`
		await downloadAudio(t.url, `${filename}.%(ext)s`, t.description || t.url)
		console.log(indexLog, 'Downloaded', t.title)
		db.query(`UPDATE tracks SET last_error = $lastError, files = $files WHERE id = $id;`).run({
			id: t.id,
			files: `${filename}.m4a`,
			lastError: null,
		})
	} catch (err: unknown) {
		const error = err as ShellError
		const msg = `Error downloading audio: ${error.stderr.toString()}`
		console.log(indexLog, msg)
		db.query(`UPDATE tracks SET files = $files, last_error = $lastError WHERE id = $id;`).run({
			id: t.id,
			files: null,
			lastError: msg,
		})
	}
}
process.exit(0)
