import React from 'react'
import ReactDOM from 'react-dom/client'
import {createBackup} from './utils.ts'
import App from './App.tsx'
import './index.css'

const {data, error} = await createBackup('oskar')
if (error) {
	console.error(error)
	throw new Error('Error creating backup')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App store={data} />
	</React.StrictMode>,
)
