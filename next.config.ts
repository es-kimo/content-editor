import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // 본문 저장이 이미지(합계 MAX_UPLOAD_BYTES 4MB, src/lib/content/upload.ts)를 함께 보낸다.
      // 기본 1MB로는 사진 한 장도 못 보내고, Vercel 함수 요청 상한 4.5MB는 넘지 않아야 한다.
      bodySizeLimit: "4.4mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
