import { SettingsCascade } from '../settings/settings'
import { SettingsEdit } from './client/services/settings'
import * as clientType from '@sourcegraph/extension-api-types'
import { Remote, ProxyMarked } from 'comlink'
import { Unsubscribable, DocumentHighlight, FileDecorationContext, TextDocument } from 'sourcegraph'
import { ProxySubscribable } from './extension/api/common'
import { TextDocumentPositionParameters } from './protocol'
import { MaybeLoadingResult } from '@sourcegraph/codeintellify'
import { HoverMerged } from './client/types/hover'
import { GraphQLResult } from '../graphql/graphql'
import { FileDecorationsByPath } from './extension/flatExtensionApi'
import { PartialModel, TextModel } from './client/services/modelService'
import { ViewerData, ViewerId } from './client/services/viewerService'

/**
 * A text model is a text document and associated metadata.
 *
 * How does this relate to editors (in {@link ViewerService}? A model is the file, an editor is the
 * window that the file is shown in. Things like the content and language are properties of the
 * model; things like decorations and the selection ranges are properties of the editor.
 */
export interface TextDocumentData extends Pick<TextDocument, 'uri' | 'languageId' | 'text'> {}

/**
 * This is exposed from the extension host thread to the main thread
 * e.g. for communicating  direction "main -> ext host"
 * Note this API object lives in the extension host thread
 */
export interface FlatExtensionHostAPI {
    /**
     * Updates the settings exposed to extensions.
     */
    syncSettingsData: (data: Readonly<SettingsCascade<object>>) => void

    // Workspace
    syncRoots: (roots: readonly clientType.WorkspaceRoot[]) => void
    syncVersionContext: (versionContext: string | undefined) => void

    // Search
    transformSearchQuery: (query: string) => ProxySubscribable<string>

    // Languages
    getHover: (parameters: TextDocumentPositionParameters) => ProxySubscribable<MaybeLoadingResult<HoverMerged | null>>
    getDocumentHighlights: (parameters: TextDocumentPositionParameters) => ProxySubscribable<DocumentHighlight[]>
    getDefinition: (
        parameters: TextDocumentPositionParameters
    ) => ProxySubscribable<MaybeLoadingResult<clientType.Location[]>>

    // Tree
    getFileDecorations: (parameters: FileDecorationContext) => ProxySubscribable<FileDecorationsByPath>

    // CONTEXT + CONTRIBUTIONS

    /**
     * Sets the given context keys and values.
     * If a value is `null`, the context key is removed.
     *
     * @param update Object with context keys as values
     */
    updateContext: (update: { [k: string]: unknown }) => void

    // TEXT DOCUMENTS

    /**
     * TODO(tj)
     *
     * @param textDocumentData
     */
    addTextDocumentIfNotExists: (textDocumentData: TextDocumentData) => void

    /**
     * Returns the {@link PartialModel} for the given uri.
     *
     */
    getPartialModel(uri: string): PartialModel

    /**
     * Adds a model.
     *
     * @param model The model to add.
     */
    addModelIfNotExists(model: TextModel): void

    /**
     * Updates a model's text content.
     *
     * @param uri The URI of the model whose content to update.
     * @param text The new text content (which will overwrite the model's previous content).
     * @throws if the model does not exist.
     */
    updateModel(uri: string, text: string): void

    /**
     * Removes a model.
     *
     * @param uri The URI of the model to remove.
     */
    removeModel(uri: string): void

    // VIEWERS

    // TODO(tj): for panel view location provider arguments
    getActiveCodeEditorPosition: () => ProxySubscribable<TextDocumentPositionParameters | null>

    /**
     * Add a viewer.
     *
     * @param viewer The description of the viewer to add.
     * @returns The added code viewer (which must be passed as the first argument to other
     * {@link ViewerService} methods to operate on this viewer).
     */
    addViewerIfNotExists(viewer: ViewerData): ViewerId

    /**
     * Sets the selections for a CodeEditor.
     *
     * @param codeEditor The editor for which to set the selections.
     * @param selections The new selections to apply.
     * @throws if no editor exists with the given editor ID.
     * @throws if the editor ID is not a CodeEditor.
     */
    setEditorSelections(codeEditor: ViewerId, selections: Selection[]): void

    /**
     * Removes a viewer.
     * Also removes the corresponding model if no other viewer is referencing it.
     *
     * @param viewer The viewer to remove.
     */
    removeViewer(viewer: ViewerId): void

    // getDecorations
}

/**
 * This is exposed from the main thread to the extension host thread"
 * e.g. for communicating  direction "ext host -> main"
 * Note this API object lives in the main thread
 */
export interface MainThreadAPI {
    /**
     * Applies a settings update from extensions.
     */
    applySettingsEdit: (edit: SettingsEdit) => Promise<void>

    /**
     * GraphQL request API
     */
    requestGraphQL: (request: string, variables: any) => Promise<GraphQLResult<any>>

    // Commands
    executeCommand: (command: string, args: any[]) => Promise<any>
    registerCommand: (
        name: string,
        command: Remote<((...args: any) => any) & ProxyMarked>
    ) => Unsubscribable & ProxyMarked
}
