import * as path from 'path';
import * as vscode from 'vscode';

import { ConfigResolver } from './configResolver';
import {
  EditorAccess,
  getDocumentLocationByExactPath,
  getFileLocation,
  getFilteredLintArray,
  LineAndIndex,
  PackageInfo,
  showErrorMessage,
} from './main';

/**
 * Returns the set of `pubspec.yaml` files that sit above `activeFileUri` in its
 * directory ancestry.
 */
const findPubspec = async (activeFileUri: vscode.Uri) => {
  const allPubspecUris = await vscode.workspace.findFiles('**/pubspec.yaml');
  return allPubspecUris.filter((pubspecUri) => {
    const packageRootUri =
      pubspecUri.with({
        path: path.dirname(pubspecUri.path),
      }) + '/';

    // Containment check
    return activeFileUri.toString().startsWith(packageRootUri.toString());
  });
};

const fetchPackageInfoFor = async (
  activeDocumentUri: vscode.Uri
): Promise<PackageInfo | null> => {
  const pubspecUris = await findPubspec(activeDocumentUri);
  if (pubspecUris.length !== 1) {
    showErrorMessage(
      `Expected to find a single pubspec.yaml file above ${activeDocumentUri}, ${pubspecUris.length} found.`
    );
    return null;
  }

  const pubspec: vscode.TextDocument = await vscode.workspace.openTextDocument(
    pubspecUris[0]
  );
  const projectRoot = path.dirname(pubspec.fileName);
  const possibleNameLines = pubspec
    .getText()
    .split('\n')
    .filter((line: string) => line.match(/^name:/));
  if (possibleNameLines.length !== 1) {
    showErrorMessage(
      `Expected to find a single line starting with 'name:' on pubspec.yaml file, ${possibleNameLines.length} found.`
    );
    return null;
  }
  const nameLine = possibleNameLines[0];
  const packageNameMatch = /^name:\s*(.*)$/gm.exec(nameLine);
  if (!packageNameMatch) {
    showErrorMessage(
      `Expected line 'name:' on pubspec.yaml to match regex, but it didn't (line: ${nameLine}).`
    );
    return null;
  }
  return {
    projectRoot: projectRoot,
    projectName: packageNameMatch[1].trim(),
  };
};

class VsCodeEditorComma implements EditorAccess {
  editor: vscode.TextEditor;

  constructor(editor: vscode.TextEditor) {
    this.editor = editor;
  }

  getFileName(): string {
    return this.editor.document.fileName;
  }
  getLineAt(idx: number): string {
    return this.editor.document.lineAt(idx).text;
  }
  getLineCount(): number {
    return this.editor.document.lineCount;
  }

  addCommaAt(idx: number, idxAt: number): Thenable<boolean> {
    return this.editor.edit(async (builder) => {
      const line = this.getLineAt(idx);
      const start = new vscode.Position(idx, 0);
      const end = new vscode.Position(idx, line.length);
      const range = new vscode.Range(start, end);

      let outputString = '';

      if (line.charAt(idxAt - 1) === '}') {
        outputString =
          line.substring(0, idxAt - 1) + ',' + line.substring(idxAt - 1);
      } else {
        outputString = line.substring(0, idxAt) + ',' + line.substring(idxAt);
      }

      builder.replace(range, outputString === '' ? line : outputString);
    });
  }
}

class VsCodeEditorUnusedImport implements EditorAccess {
  editor: vscode.TextEditor;

  constructor(editor: vscode.TextEditor) {
    this.editor = editor;
  }

  getFileName(): string {
    return this.editor.document.fileName;
  }
  getLineAt(idx: number): string {
    return this.editor.document.lineAt(idx).text;
  }
  getLineCount(): number {
    return this.editor.document.lineCount;
  }
  addCommaAt(idx: number, idxAt: number): Thenable<boolean> {
    return this.editor.edit(async (builder) => {
      const line = this.getLineAt(idx);
      const start = new vscode.Position(idx, 0);
      const end = new vscode.Position(idx, line.length);
      const range = new vscode.Range(start, end);

      builder.replace(range, '');
    });
  }
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  fixAutoCommaFixer(context);
  fixCustomCommaFixer(context);
  fixRemoveUnusedImports(context);
}

const getDirectoriesAsMapAndListOfErrors = async (
  lintsArrayFiltered: string[]
): Promise<Map<string, LineAndIndex[]>> => {
  const directories = new Map<string, LineAndIndex[]>();
  for await (const lint of lintsArrayFiltered) {
    const fileLocationAndLine = getFileLocation(lint);
    const path = fileLocationAndLine[0].substring(
      fileLocationAndLine[0].indexOf('\\') + 1
    );
    const lineNumber = fileLocationAndLine[1];
    const indexAt = fileLocationAndLine[2];

    if (!directories.has(path)) {
      directories.set(path, [
        { line: Number(lineNumber) - 1, index: Number(indexAt) - 1 },
      ]);
    } else {
      directories.get(path)!.push({
        line: Number(lineNumber) - 1,
        index: Number(indexAt) - 1,
      });
    }
  }
  return directories;
};

function fixAutoCommaFixer(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('caclint.fixAutoCommaFixer', async () => {
      const lintsArrayFiltered = await getFilteredLintArray(
        'require_trailing_commas'
      );

      const directories = new Set<string>();

      for await (const lint of lintsArrayFiltered) {
        const fileLocationAndLine = getFileLocation(lint);
        const path = fileLocationAndLine[0].substring(
          fileLocationAndLine[0].indexOf('\\') + 1
        );

        directories.add(path);
      }

      for await (const path of directories) {
        const document = await getDocumentLocationByExactPath(path);
        const activeEditor = await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand(
          'editor.action.fixAll',
          activeEditor.document.uri
        );
        await vscode.commands.executeCommand(
          'editor.action.formatDocument',
          activeEditor.document.uri
        );
      }

      await vscode.workspace.saveAll();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    })
  );
}

function fixCustomCommaFixer(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('caclint.fixCustomCommaFixer', async () => {
      const lintsArrayFiltered = await getFilteredLintArray(
        'require_trailing_commas'
      );

      const directories = await getDirectoriesAsMapAndListOfErrors(
        lintsArrayFiltered
      );

      for await (const [key, _] of directories) {
        const document = await getDocumentLocationByExactPath(key);

        const rawEditor = await vscode.window.showTextDocument(document);
        const editor = new VsCodeEditorComma(rawEditor);

        for await (const val of directories.get(key)!) {
          await editor.addCommaAt(val.line, val.index);
        }

        await vscode.commands.executeCommand(
          'editor.action.formatDocument',
          rawEditor.document.uri
        );
      }

      await vscode.workspace.saveAll();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    })
  );
}

function fixRemoveUnusedImports(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'caclint.fixRemoveUnusedImports',
      async () => {
        const lintArrayFiltered = await getFilteredLintArray(
          'unnecessary_import'
        );

        const directories = await getDirectoriesAsMapAndListOfErrors(
          lintArrayFiltered
        );

        for await (const [key, val] of directories) {
          const document = await getDocumentLocationByExactPath(key);

          const rawEditor = await vscode.window.showTextDocument(document);
          const editor = new VsCodeEditorUnusedImport(rawEditor);

          for await (const val of directories.get(key)!) {
            await editor.addCommaAt(val.line, val.index);
          }

          await vscode.commands.executeCommand(
            'editor.action.formatDocument',
            rawEditor.document.uri
          );
          await vscode.commands.executeCommand(
            'dart-import.fix',
            rawEditor.document.uri
          );
        }
        await vscode.workspace.saveAll();
        await vscode.commands.executeCommand(
          'workbench.action.closeAllEditors'
        );
      }
    )
  );
}

export function deactivate() {}
