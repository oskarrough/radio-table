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
	provider?: string
	providerId?: string
}
