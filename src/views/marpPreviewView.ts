import {
	ItemView,
	WorkspaceLeaf,
	MarkdownView,
	normalizePath,
	TFile,
} from "obsidian";
import { promises as fs } from "fs";
import * as path from "path";
import { Marp } from "@marp-team/marp-core";
import { browser, type MarpCoreBrowser } from "@marp-team/marp-core/browser";

import { MarpSlidesSettings } from "../utilities/settings";
import { MarpExport } from "../utilities/marpExport";
import { FilePath } from "../utilities/filePath";
import { MathOptions } from "@marp-team/marp-core/types/src/math/math";

const markdownItContainer = require("markdown-it-container");
const markdownItMark = require("markdown-it-mark");
const markdownItKroki = require("@kazumatu981/markdown-it-kroki");

export const MARP_PREVIEW_VIEW = "marp-preview-view";

export class MarpPreviewView extends ItemView {
	private marp: Marp;
	private static marpBrowser: MarpCoreBrowser | undefined;
	private settings: MarpSlidesSettings;
	private file: TFile | null = null;

	constructor(settings: MarpSlidesSettings, leaf: WorkspaceLeaf) {
		super(leaf);
		this.settings = settings;

		this.marp = new Marp({
			container: { tag: "div", id: "__marp-vscode" },
			slideContainer: {
				tag: "div",
				"data-marp-vscode-slide-wrapper": "",
			},
			html: this.settings.EnableHTML,
			inlineSVG: {
				enabled: true,
				backdropSelector: false,
			},
			math: this.settings.MathTypesettings as MathOptions,
			minifyCSS: true,
			script: false,
		});

		if (this.settings.EnableMarkdownItPlugins) {
			this.marp
				.use(markdownItContainer, "container")
				.use(markdownItMark)
				.use(markdownItKroki, { entrypoint: "https://kroki.io" });
		}

		// marpBrowser を静的プロパティとして初期化
		if (!MarpPreviewView.marpBrowser) {
			const container = this.containerEl.children[1];
			container.empty();
			MarpPreviewView.marpBrowser = browser(container);
		}

		// テーマの読み込み
		this.loadThemes();

		// アクションの追加
		this.addActions();
	}

	async onOpen() {
		// marpBrowser の初期化を削除
	}

	async loadThemes() {
		if (this.settings.ThemePath != "") {
			const fileContents: string[] = await Promise.all(
				this.app.vault
					.getFiles()
					.filter(
						(x) =>
							x.parent?.path ==
							normalizePath(this.settings.ThemePath)
					)
					.map((file) => this.app.vault.cachedRead(file))
			);

			fileContents.forEach((content, index) => {
				try {
					this.marp.themeSet.add(content);
				} catch (err) {
					console.error(`Failed to add theme:`, err);
					// エラーが発生した場合はスキップして続行
				}
			});
		}
	}

	getViewType() {
		return MARP_PREVIEW_VIEW;
	}

	getDisplayText() {
		return "Deck Preview";
	}

	async onClose() {
		// クリーンアップが必要な場合はここに
	}

	async onChange(view: MarkdownView) {
		this.displaySlides(view);
	}

	async onLineChanged(line: number) {
		try {
			this.containerEl.children[1].children[1].children[
				line
			].scrollIntoView();
		} catch {
			console.log("Preview slide not found!");
		}
	}

	async addActions() {
		const marpCli = new MarpExport(this.settings);

		this.addAction("image", "Export as PNG", () => {
			if (this.file) {
				marpCli.export(this.file, "png");
			}
		});

		this.addAction("code-glyph", "Export as HTML", () => {
			if (this.file) {
				marpCli.export(this.file, "html");
			}
		});

		this.addAction("slides-marp-export-pdf", "Export as PDF", () => {
			if (this.file) {
				marpCli.export(this.file, "pdf");
			}
		});

		this.addAction("slides-marp-export-pptx", "Export as PPTX", () => {
			if (this.file) {
				marpCli.export(this.file, "pptx");
			}
		});

		this.addAction("slides-marp-slide-present", "Preview Slides", () => {
			if (this.file) {
				marpCli.export(this.file, "preview");
			}
		});
	}

	async displaySlides(view: MarkdownView) {
		if (view.file != null) {
			this.file = view.file;
			const basePath = new FilePath(
				this.settings
			).getCompleteFileBasePath(view.file);
			const markdownText = view.data;

			await this.renderSlides(markdownText, basePath);
		} else {
			console.log("Error: view.file is null");
		}
	}

	// 新しく displaySlidesWithContent メソッドを追加
	async displaySlidesWithContent(content: string, file: TFile) {
		if (file != null) {
			this.file = file;
			const basePath = new FilePath(
				this.settings
			).getCompleteFileBasePath(file);
			const markdownText = content;

			await this.renderSlides(markdownText, basePath);
		} else {
			console.log("Error: file is null");
		}
	}

	// 共通のレンダリング処理をメソッド化
	private async renderSlides(markdownText: string, basePath: string) {
		if (typeof markdownText !== "string") {
			console.error("Error: markdownText is not a string");
			return;
		}

		// 画像を処理
		let processedContent = await this.processImagesForPreview(markdownText, this.file);
		
		// [[文字列]] を 文字列 に置換
		processedContent = processedContent.replace(/\[\[([^\]]+)\]\]/g, "$1");

		// テーマの再読み込み（レンダリング前に実行）
		await this.loadThemes();

		const container = this.containerEl.children[1];
		container.empty();

		let { html, css } = this.marp.render(processedContent);

		// Replace Background Url for images and other assets
		html = html.replace(
			/(?!background-image:url\(&quot;http)background-image:url\(&quot;/g,
			`background-image:url(&quot;${basePath}`
		);
		
		// Fix relative image src paths
		html = html.replace(
			/<img([^>]*?)src="(?!http)([^"]*?)"/g,
			`<img$1src="${basePath}$2"`
		);

		// テーマのCSSも含める
		let additionalCSS = "";
		if (this.settings.ThemePath != "") {
			const themeFiles = this.app.vault
				.getFiles()
				.filter(
					(x) =>
						x.parent?.path ==
						normalizePath(this.settings.ThemePath) &&
						x.extension === "css"
				);
			
			for (const file of themeFiles) {
				try {
					const themeContent = await this.app.vault.cachedRead(file);
					// @theme メタデータがあるかチェック
					if (themeContent.includes("@theme")) {
						// Marpテーマの場合は themeSet に追加
						try {
							this.marp.themeSet.add(themeContent);
						} catch (themeErr) {
							console.error(`Failed to add Marp theme ${file.name}:`, themeErr);
							// Marpテーマとして追加できない場合は通常のCSSとして追加
							additionalCSS += `\n/* Theme: ${file.name} */\n${themeContent}`;
						}
					} else {
						// 通常のCSSファイルの場合はインラインで追加
						additionalCSS += `\n/* Custom CSS: ${file.name} */\n${themeContent}`;
					}
				} catch (err) {
					console.error(`Failed to load theme ${file.name}:`, err);
				}
			}
		}

		const htmlFile = `
            <!DOCTYPE html>
            <html>
            <head>
            <style id="__marp-vscode-style">${css}${additionalCSS}</style>
            </head>
            <body>${html}</body>
            </html>
            `;

		container.innerHTML = htmlFile;
		MarpPreviewView.marpBrowser?.update();
	}

	private async processImagesForPreview(content: string, file: TFile | null): Promise<string> {
		if (!file) return content;

		// Obsidianのattachment設定を取得
		const attachmentPath = (file.vault as any).config?.attachmentFolderPath || "";
		
		// vaultPathを正しく取得する
		let vaultPath = "";
		try {
			// 複数の方法でvaultパスを取得
			const adapter = file.vault.adapter as any;
			const app = (file.vault as any).app || (this as any).app;
			
			// 方法1: adapter.basePath
			if (typeof adapter.basePath === 'string') {
				vaultPath = adapter.basePath;
			}
			// 方法2: configDirから推測
			else if (app && app.vault && typeof app.vault.configDir === 'string') {
				vaultPath = app.vault.configDir.replace('/.obsidian', '');
			}
			// 方法3: ObsidianのAPIを使用してvaultパスを取得
			else if ((this as any).app && (this as any).app.vault) {
				const appVault = (this as any).app.vault;
				if (appVault.adapter && appVault.adapter.path) {
					vaultPath = appVault.adapter.path;
				}
			}
		} catch (err) {
			console.error("Error getting vault path:", err);
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
				const imageFile = await this.findImageFileForPreview(imagePath, file, attachmentPath, vaultPath);
				
				if (imageFile) {
					// プレビューでは元のvaultからの相対パスを使用
					let relativeImagePath = imagePath;
					try {
						// vaultからの相対パスに変換
						if (vaultPath && imageFile.startsWith(vaultPath)) {
							relativeImagePath = imageFile.substring(vaultPath.length + 1);
						} else {
							// フォールバック: ファイル名のみ
							relativeImagePath = path.basename(imageFile);
						}
					} catch (err) {
						console.error("Error converting to relative path:", err);
						relativeImagePath = path.basename(imageFile);
					}
					
					// マークダウンの標準形式に統一
					const newImageRef = `![${altText}](${relativeImagePath})`;
					processedContent = processedContent.replace(originalMatch, newImageRef);
				} else {
					console.warn(`画像が見つかりません: ${imagePath}`);
				}
			}
		}

		return processedContent;
	}

	private async findImageFileForPreview(imagePath: string, file: TFile, attachmentPath: string, vaultPath: string): Promise<string | null> {
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
