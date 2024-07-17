import {sdk} from '@radio4000/sdk'
import mediaUrlParser from 'media-url-parser'
// import {pipe, map} from 'remeda'
import type {Channel, Track} from './schema.ts'
// export let supabase: SupabaseClient<Database>

/** Fetches tracks by channel slug */
export async function fetchTracks(slug: string, limit = 4000) {
	if (!slug) return {error: Error('Missing channel slug')}
	const {data, error} = await sdk.supabase
		.from('channel_tracks')
		.select(`id, slug, created_at, updated_at, title, url, discogs_url, description, tags, mentions `)
		.eq('slug', slug)
		.order('created_at', {ascending: false})
		.limit(limit)
	if (error) return {error}
	// @ts-expect-error couldn't find a way to type this
	const tracks = data.map((item) => addProviderInfo(item))
	return {data: tracks}
}

export function addProviderInfo(track: Track) {
	const {provider, id: providerId} = mediaUrlParser(track.url)
	track.provider = provider
	track.providerId = providerId
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
