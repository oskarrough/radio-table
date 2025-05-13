import {parseArgs} from 'util'

/** Get CLI arguments (only strings + booleans) */
export function parseArguments() {
	const {values} = parseArgs({
		// eslint-disable-next-line no-undef
		args: Bun.argv,
		options: {
			help: {
				type: 'boolean',
			},
			simulate: {
				type: 'boolean',
			},
			slug: {
				type: 'string',
			},
			folder: {
				type: 'string',
			},
			includeFailed: {
				type: 'boolean',
			},
			pull: {
				type: 'boolean',
			},
			download: {
				type: 'boolean',
			},
			premium: {
				type: 'boolean',
			},
			poToken: {
				type: 'string',
			},
		},
		strict: true,
		allowPositionals: true,
	})

	return values
}
