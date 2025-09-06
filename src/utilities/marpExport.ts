import marpCli, { CLIError, CLIErrorCode } from "@marp-team/marp-cli";
import { TFile } from "obsidian";
import { MarpSlidesSettings } from "./settings";
import { FilePath } from "./filePath";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

export class MarpCLIError extends Error { }

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
			// 元のmdファイルの内容を読み込む
			let content;
			try {
				content = await fs.readFile(completeFilePath, "utf8");
			} catch (err) {
				console.error("元のファイルの読み込みに失敗しました:", err);
				throw err;
			}

			// 一時ディレクトリを作成
			const tempDir = path.join(os.tmpdir(), `marp_${Date.now()}`);
			await fs.mkdir(tempDir, { recursive: true });
			
			// 画像を処理（エクスポートタイプを渡す）
			let processedContent = await this.processImages(content, file, tempDir, type);
			
			// [[文字列]] を 文字列 に置換（画像以外のwikilink）
			processedContent = processedContent.replace(/\[\[([^\]]+)\]\]/g, "$1");

			// 一時ファイルのパスを作成
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

			// console.log("一時ファイルパス:", tempFilePath);

			// 処理された内容を一時ファイルに書き込む
			try {
				await fs.writeFile(tempFilePath, processedContent);
				// console.log("一時ファイルの書き込み成功");
			} catch (err) {
				console.error("一時ファイルの書き込みに失敗しました:", err);
				throw err;
			}

			// 一時ファイルの存在を確認
			try {
				await fs.access(tempFilePath);
				// console.log("一時ファイルが存在します");
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

			const originalDir = path.dirname(completeFilePath);

			switch (type) {
				case "pdf":
					argv.push("--pdf");
					argv.push("-o");
					if (this.settings.EXPORT_PATH != "") {
						argv.push(
							`${this.settings.EXPORT_PATH}${file.basename}.pdf`
						);
					} else {
						argv.push(
							path.join(originalDir, `${file.basename}.pdf`)
						);
					}
					break;
				case "pptx":
					argv.push("--pptx");
					argv.push("-o");
					if (this.settings.EXPORT_PATH != "") {
						argv.push(
							`${this.settings.EXPORT_PATH}${file.basename}.pptx`
						);
					} else {
						argv.push(
							path.join(originalDir, `${file.basename}.pptx`)
						);
					}
					break;
				case "html":
					argv.push("--html");
					argv.push("-o");
					if (this.settings.EXPORT_PATH != "") {
						argv.push(
							`${this.settings.EXPORT_PATH}${file.basename}.html`
						);
					} else {
						argv.push(
							path.join(originalDir, `${file.basename}.html`)
						);
					}
					break;
				case "preview":
					argv.push("--preview");
					break;
				// 他のケースも同様に処理
			}

			// console.log("Marp コマンド引数:", argv);

			// カレントディレクトリを設定
			// const cwd = path.dirname(tempFilePath);

			// this.run メソッドに cwd を渡せるように修正
			try {
				await this.run(argv, resourcesPath);
				// console.log("Marp のエクスポート処理が完了しました");
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

	private async processImages(content: string, file: TFile, tempDir: string, exportType: string): Promise<string> {
		// Obsidianのattachment設定を取得
		const attachmentPath = (file.vault as any).config?.attachmentFolderPath || "";
		
		// vaultPathを正しく取得する
		let vaultPath = "";
		try {
			// 複数の方法でvaultパスを取得
			const adapter = file.vault.adapter as any;
			const app = (file.vault as any).app;
			
			// 方法1: adapter.basePath
			if (typeof adapter.basePath === 'string') {
				vaultPath = adapter.basePath;
			}
			// 方法2: configDirから推測
			else if (app && app.vault && typeof app.vault.configDir === 'string') {
				vaultPath = app.vault.configDir.replace('/.obsidian', '');
			}
			// 方法3: その他の方法でvaultパスを取得
			else {
				// 最後の手段: 環境から推測（この方法は環境に依存する）
				console.warn("Could not determine vault path automatically");
			}
		} catch (err) {
			console.error("Error getting vault path:", err);
		}
		
		// vaultPathが空の場合のフォールバック
		if (!vaultPath) {
			console.warn("vaultPath is empty, skipping image processing");
			return content;
		}
		
		// 4つの画像パターンに対応する正規表現
		const imagePatterns = [
			// ![[image.jpg]] パターン
			{
				regex: /!\[\[([^[\]]*\.(jpg|jpeg|png|gif|svg|webp|bmp|JPG|JPEG|PNG|GIF|SVG|WEBP|BMP))\]\]/gi,
				type: 'wikilink'
			},
			// ![](image.jpg) パターン
			{
				regex: /!\[([^\]]*)\]\(([^)]*\.(jpg|jpeg|png|gif|svg|webp|bmp|JPG|JPEG|PNG|GIF|SVG|WEBP|BMP))\)/gi,
				type: 'markdown'
			}
		];

		let processedContent = content;

		for (const pattern of imagePatterns) {
			let match;
			while ((match = pattern.regex.exec(content)) !== null) {
				const originalMatch = match[0];
				let imagePath = pattern.type === 'wikilink' ? match[1] : match[2];
				const altText = pattern.type === 'wikilink' ? '' : match[1];

				// 画像ファイルを探す
				const imageFile = await this.findImageFile(imagePath, file, attachmentPath, vaultPath);
				
				if (imageFile) {
					let finalImagePath: string;
					
					if (exportType === "html") {
						// HTML の場合は attachmentPath を含めた相対パスを使用
						if (attachmentPath && !imagePath.startsWith(attachmentPath)) {
							finalImagePath = path.join(attachmentPath, path.basename(imageFile)).replace(/\\/g, '/');
						} else {
							finalImagePath = imagePath;
						}
						// HTMLエクスポートでは画像はコピーしない（元の場所を参照）
						const newImageRef = `![${altText}](${finalImagePath})`;
						processedContent = processedContent.replace(originalMatch, newImageRef);
					} else {
						// PDF, PPTX, PNG などの場合は temp directory にコピー
						const tempImagePath = path.join(tempDir, path.basename(imageFile));
						try {
							await fs.copyFile(imageFile, tempImagePath);
							
							// マークダウンの標準形式に統一（ファイル名のみ）
							const newImageRef = `![${altText}](${path.basename(imageFile)})`;
							processedContent = processedContent.replace(originalMatch, newImageRef);
						} catch (err) {
							console.error(`画像のコピーに失敗しました: ${imageFile}`, err);
						}
					}
				} else {
					console.warn(`画像が見つかりません: ${imagePath}`);
				}
			}
		}

		return processedContent;
	}

	private async findImageFile(imagePath: string, file: TFile, attachmentPath: string, vaultPath: string): Promise<string | null> {
		// 引数の型チェック
		if (!vaultPath || typeof vaultPath !== 'string') {
			console.warn("vaultPath is invalid:", vaultPath);
			return null;
		}
		
		if (!file.path || typeof file.path !== 'string') {
			console.warn("file.path is invalid:", file.path);
			return null;
		}

		// 安全にパスを構築
		const searchPaths: string[] = [];
		
		try {
			// 1. 絶対パス (Archived/Attachments/image.jpg)
			searchPaths.push(path.resolve(vaultPath, imagePath));
			
			// 2. ファイル名のみ (image.jpg) の場合、attachment フォルダを探す
			if (attachmentPath && typeof attachmentPath === 'string') {
				searchPaths.push(path.resolve(vaultPath, attachmentPath, path.basename(imagePath)));
			}
			
			// 3. 現在のファイルと同じディレクトリ
			const currentFileDir = path.dirname(path.resolve(vaultPath, file.path));
			searchPaths.push(path.resolve(currentFileDir, imagePath));
			
			// 4. デフォルトのAttachmentsフォルダ
			searchPaths.push(path.resolve(vaultPath, "Attachments", path.basename(imagePath)));
			
			// 5. ArchivedのAttachmentsフォルダ
			searchPaths.push(path.resolve(vaultPath, "Archived", "Attachments", path.basename(imagePath)));
		} catch (err) {
			console.error("Error building search paths:", err);
			return null;
		}

		for (const searchPath of searchPaths) {
			try {
				await fs.access(searchPath);
				return searchPath;
			} catch {
				// ファイルが存在しない場合は次のパスを試す
			}
		}

		return null;
	}
}
