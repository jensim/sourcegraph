import { Remote, proxy } from 'comlink'
import { updateSettings } from './services/settings'
import { Subscription, from } from 'rxjs'
import { PlatformContext } from '../../platform/context'
import { isSettingsValid } from '../../settings/settings'
import { switchMap, concatMap } from 'rxjs/operators'
import { FlatExtensionHostAPI, MainThreadAPI } from '../contract'
import { ProxySubscription } from './api/common'
import { Services } from './services'

// for now it will partially mimic Services object but hopefully will be incrementally reworked in the process
export type MainThreadAPIDependencies = Pick<Services, 'commands' | 'workspace'>

/** A registered command in the command registry. */
export interface CommandEntry {
    /** The command ID (conventionally, e.g., "myextension.mycommand"). */
    command: string

    /** The function called to run the command and return an async value. */
    run: (...args: any[]) => Promise<any>
}

/**
 * TODO(tj): explain
 */
interface MainThreadState {
    commands: Map<string, CommandEntry>
}

export const initMainThreadAPI = (
    extensionHost: Remote<FlatExtensionHostAPI>,
    platformContext: Pick<PlatformContext, 'updateSettings' | 'settings' | 'requestGraphQL'>,
    dependencies: MainThreadAPIDependencies
): { api: MainThreadAPI; subscription: Subscription } => {
    const {
        workspace: { roots, versionContext },
        commands,
    } = dependencies

    const state: MainThreadState = {
        commands: new Map<string, CommandEntry>(),
    }

    const subscription = new Subscription()
    // Settings
    subscription.add(
        from(platformContext.settings)
            .pipe(
                switchMap(settings => {
                    if (isSettingsValid(settings)) {
                        return extensionHost.syncSettingsData(settings)
                    }
                    return []
                })
            )
            .subscribe()
    )

    // Workspace
    subscription.add(
        from(roots)
            .pipe(concatMap(roots => extensionHost.syncRoots(roots)))
            .subscribe()
    )
    subscription.add(
        from(versionContext)
            .pipe(concatMap(context => extensionHost.syncVersionContext(context)))
            .subscribe()
    )

    const api: MainThreadAPI = {
        applySettingsEdit: edit => updateSettings(platformContext, edit),
        requestGraphQL: (request, variables) =>
            platformContext
                .requestGraphQL({
                    request,
                    variables,
                    mightContainPrivateInfo: true,
                })
                .toPromise(),
        // Commands
        executeCommand: (command, args) => {
            const commandEntry = state.commands.get(command)
            if (!commandEntry) {
                throw new Error(`command not found: ${JSON.stringify(command)}`)
            }
            return Promise.resolve(commandEntry.run(...(args || [])))

            // return commands.executeCommand({ command, arguments: args })
        },
        registerCommand: (command, run) => {
            const subscription = new Subscription()
            subscription.add(commands.registerCommand({ command, run }))
            subscription.add(new ProxySubscription(run))
            return proxy(subscription)
        },
    }

    return { api, subscription }
}
