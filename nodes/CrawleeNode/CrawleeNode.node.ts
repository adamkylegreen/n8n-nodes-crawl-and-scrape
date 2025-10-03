import {
	NodeOperationError,
} from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { CheerioCrawler } from 'crawlee';

function appendTimestampToUrl(url: string): string {
	const separator = url.includes('?') ? '&' : '?';
	return `${url}${separator}_=${Date.now()}`;
}

export class CrawleeNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Crawl and Scrape',
		name: 'crawleeNode',
		icon: 'file:crawl-and-scrape-logo.svg',
		group: ['transform'],
		version: 1,
		description: 'Crawl websites and extract data',
		defaults: {
			name: 'Crawl and Scrape',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				description: 'The URL to crawl or scrape',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Extract Links',
						value: 'extractLinks',
						description: 'Extract all links from the page',
						action: 'Extract all links from the page',
					},
					{
						name: 'Extract Text',
						value: 'extractText',
						description: 'Extract text content from the page',
						action: 'Extract text content from the page',
					},
					{
						name: 'Extract HTML',
						value: 'extractHtml',
						description: 'Extract raw HTML content from the page',
						action: 'Extract raw HTML content from the page',
					},
				],
				default: 'extractLinks',
			},
			{
				displayName: 'Max Depth',
				name: 'maxDepth',
				type: 'number',
				default: 1,
				required: true,
				displayOptions: {
					show: {
						operation: ['extractLinks'],
					},
				},
				description: 'Maximum depth of crawling',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			let crawler: any = null;
			try {
				const url = this.getNodeParameter('url', itemIndex, '') as string;
				const operation = this.getNodeParameter('operation', itemIndex, '') as string;

				if (!url) {
					throw new NodeOperationError(this.getNode(), 'URL is required', { itemIndex });
				}

				if (operation === 'extractLinks') {
					const crawledData: any[] = [];
					const originalUrl = url;
					const maxDepth = this.getNodeParameter('maxDepth', itemIndex, 1) as number;

					crawler = new CheerioCrawler({
						maxRequestsPerCrawl: Math.min(100, maxDepth * 50),
						requestHandlerTimeoutSecs: 30,
						useSessionPool: false,
						maxConcurrency: 5,
						async requestHandler({ request, $, log }) {
							log.debug(`Crawling ${request.url}`);

							const links: string[] = [];
							$('a[href]').each((_, el: any) => {
								const href = $(el).attr('href');
								if (href) {
									try {
										links.push(new URL(href, request.url).href);
									} catch (error) {
										// Skip invalid URLs
									}
								}
							});

							crawledData.push({
								url: originalUrl,
								links,
							});
						},
					});

					await crawler.run([appendTimestampToUrl(url)]);
					const uniqueLinks = [...new Set(crawledData.flatMap(item => item.links))];
					returnData.push({
						json: {
							status: 'success',
							message: 'Crawling finished',
							data: {
								url: originalUrl,
								links: uniqueLinks,
							},
						},
					});
					crawler = null;
				} else if (operation === 'extractText') {
					const originalUrl = url;
					crawler = new CheerioCrawler({
						requestHandlerTimeoutSecs: 30,
						useSessionPool: false,
						maxConcurrency: 1,
						maxRequestsPerCrawl: 1,
						async requestHandler({ request, $, log }) {
							log.debug(`Extracting text from ${request.url}`);

							const text = $('body').text().trim();
							const truncatedText = text.length > 50000 ? text.substring(0, 50000) + '...' : text;
							returnData.push({
								json: {
									status: 'success',
									message: 'Text extraction finished',
									data: {
										url: originalUrl,
										text: truncatedText,
									},
								},
							});
						},
					});

					await crawler.run([appendTimestampToUrl(url)]);
					crawler = null;
				} else if (operation === 'extractHtml') {
					const originalUrl = url;
					crawler = new CheerioCrawler({
						requestHandlerTimeoutSecs: 30,
						useSessionPool: false,
						maxConcurrency: 1,
						maxRequestsPerCrawl: 1,
						async requestHandler({ request, body, log }) {
							log.debug(`Extracting HTML from ${request.url}`);

							const truncatedHtml = body.length > 100000 ? body.substring(0, 100000) + '...' : body;
							returnData.push({
								json: {
									status: 'success',
									message: 'HTML extraction finished',
									data: {
										url: originalUrl,
										html: truncatedHtml,
									},
								},
							});
						},
					});

					await crawler.run([appendTimestampToUrl(url)]);
					crawler = null;
				}
			} catch (error) {
				if (this.continueOnFail()) {
					items.push({ json: this.getInputData(itemIndex)[0].json, error, pairedItem: itemIndex });
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			} finally {
				if (crawler) {
					try {
						await crawler.teardown();
					} catch (teardownError) {
						// Log teardown errors but don't throw to avoid masking original errors
					}
				}
			}
		}

		return [returnData];
	}
}
