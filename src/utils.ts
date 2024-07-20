import {$, ShellError} from 'bun'
import {Database} from 'bun:sqlite'
import {sdk} from '@radio4000/sdk'
import mediaUrlParser from 'media-url-parser'
import {
	LocalTrackSchema,
	TrackSchema,
	TrackTableSchema,
	type LocalTrack,
	type RemoteTrack,
	type Track,
} from './schema.ts'
import filenamify from 'filenamify'

/** Fetches tracks by channel slug */
export async function fetchRemoteTracks(slug: string, limit = 4000) {
	if (!slug) return {error: Error('Missing channel slug')}
	const {data, error} = await sdk.supabase
		.from('channel_tracks')
		.select(`id, slug, created_at, updated_at, title, url, discogs_url, description, tags, mentions `)
		.eq('slug', slug)
		.order('created_at', {ascending: false})
		.limit(limit)
		.returns<RemoteTrack[]>()
	if (error) return {error: new Error(`Failed to fetch tracks`)}
	return {data}
}

/** Parses the track's URL and adds provider + provider id */
export function addProviderInfo(track: Track | RemoteTrack) {
	const {provider, id: providerId} = mediaUrlParser(track.url)
	return {
		...track,
		provider,
		providerId,
	}
}

// remote -> track
// track -> local
// local -> track

export function remoteTrackToTrack(t: RemoteTrack) {
	try {
		const track = TrackSchema.parse({
			id: t.id,
			createdAt: t.created_at,
			updatedAt: t.updated_at,
			slug: t.slug,
			url: t.url,
			title: t.title,
			description: t.description,
			tags: t.tags,
			mentions: t.mentions,
			discogsUrl: t.discogs_url,
		})
		return addProviderInfo(track)
	} catch (err) {
		const prop = [err.errors[0].path[0]]
		console.log('Failed to parse remote track -> track', {
			id: t.id,
			invalidProp: prop[0],
			value: t[prop[0]],
		})
		return null
	}
}

export function trackToLocalTrack(t: Track): LocalTrack {
	try {
		return LocalTrackSchema.parse({
			...t,
			tags: t.tags ? t.tags.join(',') : null,
			mentions: t.mentions ? t.mentions.join(',') : null,
		})
	} catch (err) {
		const prop = [err.errors[0].path[0]]
		console.log('Failed to parse track -> local track', t.id, prop[0], err.message)
		return null
	}
}

export function localTrackToTrack(t: LocalTrack) {
	try {
		return TrackSchema.parse({
			...t,
			tags: t.tags ? t.tags.split(',') : [],
			mentions: t.mentions ? t.mentions.split(',') : [],
		})
	} catch (error) {
		const prop = [err.errors[0].path[0]]
		console.log('Failed to parse local track -> track', t.id, prop[0], err.message)
		return null
	}
}

/** Fetches the channel and tracks and handles errors */
export async function createBackup(slug: string, limit?: number) {
	const promises = [sdk.channels.readChannel(slug), fetchRemoteTracks(slug, limit)]
	try {
		const [radio, tracks] = await Promise.all(promises)
		if (radio.error) throw new Error('Failed to fetch radio. Was it migrated to Radio4000 v2?')
		if (tracks.error) throw new Error(tracks.error.message)
		return {
			data: {
				radio: radio.data as Channel,
				tracks: tracks.data as RemoteTrack[],
			},
		}
	} catch (err) {
		return {error: err}
	}
}

/** Downloads the audio from a URL (supported by yt-dlp) */
export async function downloadAudio(url: string, filepath: string, metadataDescription: string) {
	return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet --progress ${url}`
}

export function toFilename(track: LocalTrack | Track, filepath: string) {
	const cleanTitle = filenamify(track.title, {replacement: ' ', maxLength: 255})
	return `${filepath}/${cleanTitle} [${track.providerId}].m4a`
}

/** Downloads the URL of a track to disk, and updates the track in the local database. */
export async function downloadTrack(t: LocalTrack | Track, filename: string, db: Database) {
	try {
		await downloadAudio(t.url, `${filename}`, t.description || '')
		db.query(`UPDATE tracks SET files = $files, lastError = $lastError WHERE id = $id;`).run({
			id: t.id,
			files: `${filename}`,
			lastError: null,
		})
	} catch (err: unknown) {
		const error = err as ShellError
		t.lastError = `Error downloading track: ${error.stderr.toString()}`
		console.error(t.lastError)
		db.query(`UPDATE tracks SET files = $files, lastError = $lastError WHERE id = $id;`).run({
			id: t.id,
			files: null,
			lastError: t.lastError,
		})
	}
}

/** Set up (or reuse) a local sqlite database */
export async function setupDatabase(filename: string) {
	const db = new Database(filename, {
		strict: true,
	})
	db.exec('PRAGMA journal_mode = WAL;')
	db.run(TrackTableSchema)
	return db
}

const upsertTrackQuery = (db: Database) =>
	db.query(
		`INSERT OR REPLACE INTO tracks (id, slug, createdAt, updatedAt, title, url, discogsUrl, description, tags, mentions, provider, providerId, files, lastError) VALUES ($id, $slug, $createdAt, $updatedAt, $title, $url, $discogsUrl, $description, $tags, $mentions, $provider, $providerId, $files, $lastError);`,
	)
/** Throws if it cant upsert */
export async function upsertLocalTrack(db: Database, t: Track) {
	const trackToInsert = trackToLocalTrack(t)
	const track = LocalTrackSchema.parse(trackToInsert)
	// existing fields would be overwritten, so we keep them here.
	const existing = db.query(`SELECT * FROM tracks WHERE id = $id;`).get({id: track.id}) as LocalTrack
	if (existing) {
		track.files = t.files || existing.files
		track.lastError = t.lastError || existing.lastError
	} else {
		track.files = t.files || null
		track.lastError = t.lastError || null
	}
	console.log('Upserted local track', track.title, track.files)
	upsertTrackQuery(db).run(track)
}
