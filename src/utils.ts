import {sdk} from '@radio4000/sdk'
import mediaUrlParser from 'media-url-parser'
import type {Channel, TrackR4, Track} from './schema.ts'
// import {pipe, map} from 'remeda'

/** Fetches tracks by channel slug */
export async function fetchTracks(slug: string, limit = 4000) {
	if (!slug) return {error: Error('Missing channel slug')}
	const {data, error} = await sdk.supabase
		.from('channel_tracks')
		.select(`id, slug, created_at, updated_at, title, url, discogs_url, description, tags, mentions `)
		.eq('slug', slug)
		.order('created_at', {ascending: false})
		.limit(limit)
		.returns<TrackR4[]>()
	if (error) return {error}
	const tracks = data.map(addProviderInfo).map(serializeTrack)
	return {data: tracks}
}

/** Parses the track's URL and adds provider + provider id */
export function addProviderInfo(track: TrackR4) {
	const {provider, id: providerId} = mediaUrlParser(track.url)
	return {
		...track,
		provider,
		providerId,
	}
}

export function serializeTrack(t: TrackR4) {
	const track = {...t} as Track
	// R4 returns an array of tags/mentions, but sqlite doesn't support that.
	if (t.tags) track.tags = t.tags.join(',')
	if (t.mentions) track.mentions = t.mentions.join(',')
	return track
}

/** Fetches the channel and tracks and handles errors */
export async function createBackup(slug: string, limit?: number) {
	const promises = [sdk.channels.readChannel(slug), fetchTracks(slug, limit)]
	try {
		const [radio, tracks] = await Promise.all(promises)
		if (radio.error) throw new Error('Failed to fetch radio. Was it migrated to Radio4000 v2?')
		if (tracks.error) throw new Error(tracks.error.message)
		return {
			data: {
				radio: radio.data as Channel,
				tracks: tracks.data as Track[],
			},
		}
	} catch (err) {
		return {error: err}
	}
}
