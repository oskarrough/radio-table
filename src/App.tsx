import './App.css'
import TheTable from './the-table'

function App(props) {
	console.log('app got props', props)
	return (
		<>
			<p>This page loads a Radio4000 channel and displays all tracks in a table you can control.</p>
			<ul>
				<li>Table headers cycle sorted between desc, asc and unsorted</li>
				<li>There is a global search filter</li>
				<li>Tags can be filtered (multiple includes)</li>
			</ul>
			<TheTable store={props.store} />
		</>
	)
}

export default App
