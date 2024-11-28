import marpCli, { CLIError, CLIErrorCode } from "@marp-team/marp-cli";
import { TFile } from "obsidian";
import { MarpSlidesSettings } from "./settings";
import { FilePath } from "./filePath";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

export class MarpCLIError extends Error {}

export class MarpExport {
	private settings: MarpSlidesSettings;

	constructor(settings: MarpSlidesSettings) {
		this.settings = settings;
	}

	async export(file: TFile, type: string) {
		const filesTool = new FilePath(this.settings);
		await filesTool.removeFileFromRoot(file);
		await filesTool.copyFileToRoot(file);
		const completeFilePath = filesTool.getCompleteFilePath(file);
		const themePath = filesTool.getThemePath(file);
		const resourcesPath = filesTool.getLibDirectory(file.vault);
		const marpEngineConfig = filesTool.getMarpEngine(file.vault);

		if (completeFilePath != "") {
			console.log("元のファイルパス:", completeFilePath);

			// 元のmdファイルの内容を読み込む
			let content;
			try {
				content = await fs.readFile(completeFilePath, "utf8");
				console.log("元のファイルの読み込み成功");
			} catch (err) {
				console.error("元のファイルの読み込みに失敗しました:", err);
				throw err;
			}

			// [[文字列]] を 文字列 に置換
			const processedContent = content.replace(/\[\[(.*?)\]\]/g, "$1");

			// 一時ファイルのパスを作成
			const tempDir = os.tmpdir();
			const tempFileName = `temp_${file.basename}_${Date.now()}.md`;
			const tempFilePath = path.join(tempDir, tempFileName);

			// 	// 処理された内容を一時ファイルに書き込む
			// 	await fs.writeFile(tempFilePath, processedContent);

			// // 一時ファイルのパスを作成（絶対パスを使用）
			// const tempFileName = `temp_${Date.now()}.md`;
			// const tempFilePath = path.resolve(
			// 	path.dirname(completeFilePath),
			// 	tempFileName
			// );

			console.log("一時ファイルパス:", tempFilePath);

			// 処理された内容を一時ファイルに書き込む
			try {
				await fs.writeFile(tempFilePath, processedContent);
				console.log("一時ファイルの書き込み成功");
			} catch (err) {
				console.error("一時ファイルの書き込みに失敗しました:", err);
				throw err;
			}

			// 一時ファイルの存在を確認
			try {
				await fs.access(tempFilePath);
				console.log("一時ファイルが存在します");
			} catch (err) {
				console.error("一時ファイルが存在しません:", err);
				throw err;
			}

			// 一時ファイルのパスを使用してエクスポート
			const argv: string[] = [tempFilePath, "--allow-local-files"];

			if (this.settings.EnableMarkdownItPlugins) {
				argv.push("--engine");
				argv.push(marpEngineConfig);
			}

			if (themePath != "") {
				argv.push("--theme-set");
				argv.push(themePath);
			}

			switch (type) {
				case "pdf":
					argv.push("--pdf");
					if (this.settings.EXPORT_PATH != "") {
						argv.push("-o");
						argv.push(
							`${this.settings.EXPORT_PATH}${file.basename}.pdf`
						);
					}
					break;
				case "pptx":
					argv.push("--pptx");
					if (this.settings.EXPORT_PATH != "") {
						argv.push("-o");
						argv.push(
							`${this.settings.EXPORT_PATH}${file.basename}.pptx`
						);
					}
					break;
				case "html":
					argv.push("--html");
					if (this.settings.EXPORT_PATH != "") {
						argv.push("-o");
						argv.push(
							`${this.settings.EXPORT_PATH}${file.basename}.html`
						);
					}
					break;
				case "preview":
					argv.push("--preview");
					break;
				// 他のケースも同様に処理
			}

			console.log("Marp コマンド引数:", argv);

			// カレントディレクトリを設定
			// const cwd = path.dirname(tempFilePath);

			// this.run メソッドに cwd を渡せるように修正
			try {
				await this.run(argv, resourcesPath);
				console.log("Marp のエクスポート処理が完了しました");
			} catch (err) {
				console.error("Marp のエクスポート処理に失敗しました:", err);
				throw err;
			}

			// // 一時ファイルを削除
			// try {
			// 	await fs.unlink(tempFilePath);
			// 	console.log("一時ファイルを削除しました");
			// } catch (err) {
			// 	console.error("一時ファイルの削除に失敗しました:", err);
			// 	// エラーを投げずに続行
			// }
		}
	}

	//async exportPdf(argv: string[], opts?: MarpCLIAPIOptions | undefined){
	private async run(argv: string[], resourcesPath: string) {
		const { CHROME_PATH } = process.env;

		try {
			process.env.CHROME_PATH = this.settings.CHROME_PATH || CHROME_PATH;

			this.runMarpCli(argv, resourcesPath);
		} catch (e) {
			console.error(e);

			if (
				e instanceof CLIError &&
				e.errorCode === CLIErrorCode.NOT_FOUND_CHROMIUM
			) {
				const browsers = [
					"[Google Chrome](https://www.google.com/chrome/)",
				];

				if (process.platform === "linux")
					browsers.push("[Chromium](https://www.chromium.org/)");

				browsers.push(
					"[Microsoft Edge](https://www.microsoft.com/edge)"
				);

				throw new MarpCLIError(
					`It requires to install ${browsers
						.join(", ")
						.replace(/, ([^,]*)$/, " or $1")} for exporting.`
				);
			}

			throw e;
		} finally {
			process.env.CHROME_PATH = CHROME_PATH;
		}
	}

	private async runMarpCli(argv: string[], resourcesPath: string) {
		//console.info(`Execute Marp CLI [${argv.join(' ')}] (${JSON.stringify(opts)})`)
		console.info(`Execute Marp CLI [${argv.join(" ")}]`);
		let temp__dirname = __dirname;

		try {
			__dirname = resourcesPath;
			const exitCode = await marpCli(argv, {});

			if (exitCode > 0) {
				console.error(`Failure (Exit status: ${exitCode})`);
			}
		} catch (e) {
			if (e instanceof CLIError) {
				console.error(
					`CLIError code: ${e.errorCode}, message: ${e.message}`
				);
			} else {
				console.error("Generic Error!");
			}
		}

		__dirname = temp__dirname;
	}
}
