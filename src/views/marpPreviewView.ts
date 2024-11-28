import {
	ItemView,
	WorkspaceLeaf,
	MarkdownView,
	normalizePath,
	TFile,
} from "obsidian";
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

			fileContents.forEach((content) => {
				this.marp.themeSet.add(content);
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
			this.containerEl.children[1].children[2].children[
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

		const container = this.containerEl.children[1];
		container.empty();

		let { html, css } = this.marp.render(markdownText);

		// Replace Background Url for images
		html = html.replace(
			/(?!background-image:url\(&quot;http)background-image:url\(&quot;/g,
			`background-image:url(&quot;${basePath}`
		);

		const htmlFile = `
            <!DOCTYPE html>
            <html>
            <head>
            <base href="${basePath}"></base>
            <style id="__marp-vscode-style">${css}</style>
            </head>
            <body>${html}</body>
            </html>
            `;

		container.innerHTML = htmlFile;
		MarpPreviewView.marpBrowser?.update();
	}
}
