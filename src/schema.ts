export interface Track {
	// from supabase schema
	id: string
	created_at: string
	updated_at: string
	title: string
	url: string
	discogs_url?: string
	description?: string
	tags: string[]
	mentions: string[]
	// from channel_tracks view
	slug: string
	// custom ones
	downloaded?: number
	files?: string
	lastError?: string
	// computed from mediaUrlParser
	provider?: string
	providerId?: string
}

export interface Channel {
	coordinates: unknown | null
	created_at: string | null
	description: string | null
	favorites: string[] | null
	firebase_id: string | null
	followers: string[] | null
	fts: unknown | null
	id: string
	image: string | null
	latitude: number | null
	longitude: number | null
	name: string
	slug: string
	updated_at: string | null
	url: string | null
}
