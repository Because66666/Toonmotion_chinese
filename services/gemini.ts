import OpenAI from 'openai';

// Extend Window interface to support aistudio if needed, or just use any
declare global {
  interface Window {
    aistudio?: any;
  }
}

const getAiClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not found. Please select an API Key.");
  }
  return new OpenAI({
    apiKey: process.env.API_KEY,
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    dangerouslyAllowBrowser: true
  });
};

/**
 * Generates a single frame based on the input image and prompt.
 */
const generateSingleFrame = async (
  imageBase64: string,
  mimeType: string,
  prompt: string,
  index: number,
  total: number
): Promise<string> => {
  const openai = getAiClient();

  // Prompt optimized for single-frame consistency
  const enhancedPrompt = `生成动画序列的第 ${index + 1} 帧，共 ${total} 帧。

  主题：虚构的通用 Q 版游戏角色。
  视觉风格：2D 数字游戏美术，扁平色彩，高对比度。
  动作：${prompt}

  关键约束：
  1. **视角**：全身、正面、正交视图。
  2. **背景**：纯白色 (#FFFFFF)。
  3. **构图**：角色必须在画面中完整可见，不得裁剪。
  4. **一致性**：保持与参考图像完全一致的角色比例和设计细节。
  5. **内容**：禁止出现文字、网格线、数字或任何额外物品。仅允许一个角色。

  输出：一张高质量的单幅图像。`;

  try {
    const response = await openai.chat.completions.create({
      model: 'ep-20251127000002-dblf6', // Using the model specified by user context (implied via proxy)
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: enhancedPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`
              }
            }
          ]
        }
      ],
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
        throw new Error("OpenAI API returned no content.");
    }

    // Strategy 1: Look for Markdown Image
    const markdownMatch = content.match(/!\[.*?\]\((.*?)\)/);
    if (markdownMatch && markdownMatch[1]) {
        return await fetchAndCreateBlobUrl(markdownMatch[1]);
    }

    // Strategy 2: Look for raw URL
    const urlMatch = content.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch && urlMatch[0]) {
        return await fetchAndCreateBlobUrl(urlMatch[0]);
    }
    
    // Strategy 3: Check if content is Base64 (unlikely for Chat API but possible for some proxies)
    // Simple check: does it look like base64?
    if (content.length > 100 && !content.includes(' ')) {
        try {
             const blob = b64toBlob(content, 'image/png'); // Assume PNG
             return URL.createObjectURL(blob);
        } catch (e) {
            // Not base64
        }
    }

    throw new Error(`Could not find image in response: ${content.slice(0, 100)}...`);

  } catch (error: any) {
    console.error(`Error generating frame ${index + 1}:`, error);
    throw error;
  }
};

// Helper to fetch URL and return Blob URL (avoids CORS issues in Canvas)
const fetchAndCreateBlobUrl = async (url: string): Promise<string> => {
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn("Failed to fetch image URL, returning original URL:", e);
        return url; // Fallback
    }
};

// Helper for Base64 (if needed)
const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  const blob = new Blob(byteArrays, { type: contentType });
  return blob;
};

/**
 * Generates multiple frames in parallel batches.
 * Supports abortion via AbortSignal.
 */
export const generateAnimationFrames = async (
  imageBase64: string,
  mimeType: string,
  prompt: string,
  count: number,
  signal?: AbortSignal
): Promise<string[]> => {
  const urls: string[] = [];
  const batchSize = 3; // Process 3 at a time to avoid rate limits

  for (let i = 0; i < count; i += batchSize) {
    if (signal?.aborted) {
        throw new Error("Generation aborted by user.");
    }

    const batchPromises = [];
    for (let j = i; j < Math.min(i + batchSize, count); j++) {
       // Add a tiny delay between requests to be nice to the API
       await new Promise(r => setTimeout(r, 100 * (j - i)));
       batchPromises.push(generateSingleFrame(imageBase64, mimeType, prompt, j, count));
    }
    
    const batchResults = await Promise.all(batchPromises);
    
    if (signal?.aborted) {
        throw new Error("Generation aborted by user.");
    }
    
    urls.push(...batchResults);
  }

  return urls;
};

export const checkApiKey = async (): Promise<boolean> => {
  if (process.env.API_KEY && process.env.API_KEY.length > 0) {
    return true;
  }
  // Legacy check for AIStudio environment
  if (typeof window !== 'undefined' && window.aistudio && window.aistudio.hasSelectedApiKey) {
    try {
        return await window.aistudio.hasSelectedApiKey();
    } catch (e) {
        console.warn("Failed to check hasSelectedApiKey", e);
        return false;
    }
  }
  return false;
};

export const promptApiKeySelection = async (): Promise<void> => {
  if (process.env.API_KEY) {
    return;
  }
  console.warn("API Key not found in environment.");
  alert("请在 .env 文件中配置 API_KEY (例如 API_KEY=sk-...)，然后重启服务。");
};
