import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { sdk } from '@radio4000/sdk'

export interface Track {
	id: string
	created_at: string
	updated_at: string
	title: string
	url: string
	description?: string
	tags: string[]
	mentions: string[]
}

/** Fetches tracks by channel slug */
export async function getNiceTracks(slug: string): Promise<{ data?: Track[]; error?: { message: string } }> {
	if (!slug) return { error: { message: 'Missing channel slug' } }
	const { data, error } = await sdk.supabase
		.from('channel_track')
		.select(
			`
			channel_id!inner( slug ),
			track_id( id, created_at, updated_at, title, url, discogs_url, description, tags, mentions )
		`,
		)
		.eq('channel_id.slug', slug)
		.order('created_at', { ascending: false })
		.limit(500) // @todo set to 5k
	if (error) return { error }
	return { data: data.map((x) => x.track_id) }
}

async function bootstrapLocalData() {
	const slug = 'ko002'
	// @todo rewrite with an effect.js
	const promises = [sdk.channels.readChannel(slug), getNiceTracks(slug)]
	const [radio, tracks] = await Promise.allSettled(promises)
	return {
		radio: radio.value.data,
		tracks: tracks.value.data,
	}
}

const { radio, tracks } = await bootstrapLocalData()
const store = { radio, tracks }

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App store={store} />
	</React.StrictMode>,
)
