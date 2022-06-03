"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nftStorageUploadGenerator = void 0;
const loglevel_1 = __importDefault(require("loglevel"));
// import fs from 'fs';
const path_1 = __importDefault(require("path"));
const metaplex_auth_1 = require("@nftstorage/metaplex-auth");
const nft_storage_1 = require("nft.storage");
const cliProgress = __importStar(require("cli-progress"));
async function* nftStorageUploadGenerator({ dirname, assets, env, walletKeyPair, nftStorageKey, nftStorageGateway, batchSize, }) {
    // split asset keys into batches, each of which will be bundled into a CAR file and uploaded separately
    // default to 50 NFTs per "batch" if no batchSize is given.
    // larger batches require fewer signatures and will be slightly faster overall if everything is sucessful,
    // but smaller batches will take less time to retry if there's an error during upload.
    batchSize = batchSize || 50;
    batchSize = Math.min(batchSize, metaplex_auth_1.NFTBundle.MAX_ENTRIES);
    const numBatches = Math.ceil(assets.length / batchSize);
    const batches = new Array(numBatches)
        .fill([])
        .map((_, i) => assets.slice(i * batchSize, (i + 1) * batchSize));
    loglevel_1.default.info(`Uploading to nft.storage in ${batches.length} batches`);
    // upload the CAR file for a single bundle to nft.storage
    const uploadCar = async (cid, car, onStoredChunk) => {
        if (nftStorageKey) {
            const client = new nft_storage_1.NFTStorage({ token: nftStorageKey });
            return client.storeCar(car, { onStoredChunk });
        }
        else {
            const client = await metaplex_auth_1.NFTStorageMetaplexor.withSecretKey(walletKeyPair.secretKey, {
                solanaCluster: env,
                mintingAgent: 'metaplex/candy-machine-v2-cli',
            });
            return client.storeCar(cid, car, { onStoredChunk });
        }
    };
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;
        const bundle = new metaplex_auth_1.NFTBundle();
        const bundled = [];
        loglevel_1.default.debug(`Generating bundle #${batchNum} of ${batches.length}`);
        const packProgressBar = new cliProgress.SingleBar({
            format: `Generating bundle #${batchNum}: [{bar}] {percentage}% | {value}/{total}`,
        }, cliProgress.Presets.shades_classic);
        packProgressBar.start(batch.length, 0);
        for (const asset of batch) {
            const manifestPath = path_1.default.join(dirname, `${asset.index}.json`);
            const imagePath = path_1.default.join(dirname, asset.index + asset.mediaExt);
            // if animation_url is set to a filepath, that will be picked up by
            // bundle.addNFTFromFileSystem below.
            loglevel_1.default.debug(`Adding NFT ${asset.index} to bundle #${batchNum} from ${manifestPath}`);
            const nft = await bundle.addNFTFromFileSystem(manifestPath, imagePath, {
                id: asset.index,
                gatewayHost: nftStorageGateway,
            });
            bundled.push({
                cacheKey: asset.index,
                metadataJsonLink: nft.metadataGatewayURL,
                updatedManifest: nft.metadata,
            });
            packProgressBar.update(bundled.length);
        }
        packProgressBar.stop();
        const { car, cid } = await bundle.asCAR();
        const totalSize = await bundle.getRawSize();
        const uploadProgressBar = new cliProgress.SingleBar({
            format: `Uploading bundle #${batchNum}: [{bar}] {percentage}%`,
        }, cliProgress.Presets.shades_classic);
        let stored = 0;
        uploadProgressBar.start(totalSize, stored);
        const onStoredChunk = (size) => {
            stored += size;
            uploadProgressBar.update(stored);
        };
        const bundleCID = await uploadCar(cid, car, onStoredChunk);
        uploadProgressBar.stop();
        loglevel_1.default.info(`Completed upload for bundle #${batchNum} of ${batches.length}. Bundle root CID: ${bundleCID}`);
        yield {
            assets: bundled,
        };
    }
}
exports.nftStorageUploadGenerator = nftStorageUploadGenerator;
