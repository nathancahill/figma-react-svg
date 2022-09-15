import api from "axios";

const headers = {
  "X-FIGMA-TOKEN": process.env.FIGMA_ACCESS_TOKEN,
};

/**
 * api endpoint for files
 *
 */
const instanceFiles = (fileId) =>
  api.create({
    baseURL: `https://api.figma.com/v1/files/${fileId}`,
    headers,
  });

/**
 * api endpoint for images
 *
 */
const instanceImages = (fileId) =>
  api.create({
    baseURL: `https://api.figma.com/v1/images/${fileId}`,
    headers,
  });

/**
 * get Figma document info
 *
 * @return {Promise<Object>}
 */
export const getDocument = async (fileId) => instanceFiles(fileId).get("/");

/**
 * get Figma node info
 *
 * @param {string} nodeId
 * @return {Promise<Object>}
 */
export const getNode = async (fileId, nodeId) =>
  instanceFiles(fileId).get(`/nodes?ids=${decodeURIComponent(nodeId)}`);

/**
 * get Figma node children
 *
 * @param {string} nodeId
 * @return {Promise<[Object]>}
 */
export const getNodeChildren = async (fileId, nodeId) => {
  const {
    data: { nodes },
  } = await instanceFiles(fileId).get(
    `/nodes?ids=${decodeURIComponent(nodeId)}`
  );
  return nodes[nodeId].document.children;
};

/**
 * get Svg image resource url
 *
 * @param {string} nodeId
 * @return {Promise<string>}
 */
export const getSvgImageUrl = async (fileId, nodeId) => {
  const {
    data: { images },
  } = await instanceImages(fileId).get(
    `/?ids=${decodeURIComponent(nodeId)}&format=svg`
  );
  return images[nodeId];
};

/**
 * get Svg image resource urls
 *
 * @param {string[]} nodeIds
 * @return {Promise<string>}
 */
export const getSvgImageUrls = async (fileId, nodeIds) => {
  const {
    data: { images },
  } = await instanceImages(fileId).get(`/?ids=${nodeIds.join(",")}&format=svg`);
  return images;
};

/**
 * get image content
 *
 * @param {string} url - image url
 * @return {Promise<Object>}
 */
export const getImageContent = async (url) => api.get(url);
