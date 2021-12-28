import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { ConfigResolver } from './configResolver';

interface PackageInfo {
  projectRoot: string;
  projectName: string;
}

interface LineAndIndex {
  line: number;
  index: number;
}

interface EditorAccess {
  getFileName(): string;
  getLineAt(idx: number): string;
  getLineCount(): number;
  addCommaAt(idx: number, idxAt: number): Thenable<boolean>;
}

const configResolver = new ConfigResolver();

const execShell = (cmd: string) =>
  new Promise<string>((resolve, reject) => {
    cp.exec(cmd, (err, out) => {
      if (err) {
        return reject(err);
      }
      return resolve(out);
    });
  });

const getFileLocation = (info: string) => {
  const matches = info.matchAll(/^.*?[-]\s(.*?)?(?=:):(\d+):(\d+)/g);
  let path = '';
  let line = '';
  let index = '';

  for (const match of matches) {
    path = match[1];
    line = match[2];
    index = match[3];
  }

  return [path, line, index];
};

const showInfoMessage = (message: string) => {
  if (configResolver.showInfoMessages) {
    vscode.window.showInformationMessage(message);
  }
};

const showErrorMessage = (message: string) => {
  if (configResolver.showErrorMessages) {
    vscode.window.showErrorMessage(message);
  }
};

const getFilteredLintArray = async (filter: string) => {
  const isWindows = process.platform === 'win32';
  const folder = vscode.workspace.workspaceFolders![0].uri.path.substring(
    1,
    vscode.workspace.workspaceFolders![0].uri.path.length
  );

  const directory = path.dirname(folder);
  let lintsArray: string[] = [];

  if (isWindows) {
    const drive = directory.substring(0, 2);

    showInfoMessage('Running dart analyze...');
    const lints = await execShell(
      `${drive} && cd ${directory} && dart analyze .`
    );
    lintsArray = lints.split('\n');
  }

  const lintsArrayFiltered = lintsArray!.filter((element) =>
    element.includes(filter)
  );

  return lintsArrayFiltered;
};

const getDocumentLocationByExactPath = async (
  path: string
): Promise<vscode.TextDocument> => {
  const fileUri = await vscode.workspace.findFiles(path);
  return await vscode.workspace.openTextDocument(fileUri[0]);
};

export {
  PackageInfo,
  EditorAccess,
  getFileLocation,
  LineAndIndex,
  showErrorMessage,
  getFilteredLintArray,
  getDocumentLocationByExactPath,
};
