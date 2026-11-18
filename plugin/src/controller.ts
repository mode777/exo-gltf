import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { errorDetails, renderObservation } from './observation'

/** Must match the single contribution declared in public/exo-manifest.json. */
const CONTRIBUTION = {
  glob: '**/*.{gltf,glb}',
  entry: 'editor.html',
  label: 'glTF',
} as const

async function main(): Promise<void> {
  try {
    const connection = await connectBrowserPlugin()
    if (connection.mode !== 'register') {
      throw new Error('The controller entry must be mounted in register mode.')
    }
    connection.registration.register({ ...CONTRIBUTION })
    const ack = await connection.registration.complete()
    renderObservation(
      { mode: 'register', phase: 'complete', accepted: ack.accepted, rejected: ack.rejected },
      `glTF Viewer registered ${ack.accepted.length}`,
    )
    console.log('EXO_GLTF_REGISTER', ack.accepted, ack.rejected)
  } catch (error) {
    const details = errorDetails(error)
    renderObservation({ mode: 'register', phase: 'error', error: details }, 'glTF Viewer register error')
    console.error('EXO_GLTF_REGISTER_ERROR', details)
  }
}

void main()
