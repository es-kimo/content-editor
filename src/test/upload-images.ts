/** 형식 판별(`sniffFormat`)만 통과하는 최소 이미지 바이트와, 이미지 하나를 이미 쓰는 글. */
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
export const PNG = new Uint8Array([0x89, ...ascii("PNG\r\n\x1a\n"), 0, 0]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
export const WEBP = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")]);
export const GIF = new Uint8Array(ascii("GIF89a"));

export const SOURCE = 'import image1 from "./1.png";\n\n<Image src={image1} alt="" />\n';
