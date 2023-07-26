import * as chainsRaw from "./chains.json";
import * as dotenv from "dotenv";
import path from "path";
import { SourcifyEventManager } from "./common/SourcifyEventManager/SourcifyEventManager";
import {
    SourcifyChain,
    SourcifyChainMap,
    SourcifyChainExtension,
    Chain,
} from "@ethereum-sourcify/lib-sourcify";
import { etherscanAPIs } from "./config";
import { ValidationError } from "./common/errors";
import { logger } from "./common/loggerLoki";
import { FetchRequest } from "ethers";

const allChains = chainsRaw as Chain[];

dotenv.config({
    path: path.resolve(__dirname, "..", "..", "..", "environments/.env"),
});

const ETHERSCAN_REGEX = ["at txn.*href=.*/tx/(0x.{64})"]; // save as string to be able to return the txRegex in /chains response. If stored as RegExp returns {}
const ETHERSCAN_SUFFIX = "address/${ADDRESS}";
const ETHERSCAN_API_SUFFIX = `/api?module=contract&action=getcontractcreation&contractaddresses=\${ADDRESS}&apikey=`;
const BLOCKSSCAN_SUFFIX = "api/accounts/${ADDRESS}";
const BLOCKSCOUT_REGEX_OLD =
  'transaction_hash_link" href="${BLOCKSCOUT_PREFIX}/tx/(.*?)"';
const BLOCKSCOUT_REGEX_NEW = "at txn.*href.*/tx/(0x.{64}?)";
const BLOCKSCOUT_SUFFIX = "address/${ADDRESS}/transactions";
const TELOS_SUFFIX = "v2/evm/get_contract?contract=${ADDRESS}";
const METER_SUFFIX = "api/accounts/${ADDRESS}";
const AVALANCHE_SUBNET_SUFFIX =
  "contracts/${ADDRESS}/transactions:getDeployment";

type ChainName = "eth" | "polygon" | "arb" | "opt";

const LOCAL_CHAINS: SourcifyChain[] = [
    new SourcifyChain({
        name: "Ganache Localhost",
        shortName: "Ganache",
        chainId: 1337,
        faucets: [],
        infoURL: "localhost",
        nativeCurrency: { name: "localETH", symbol: "localETH", decimals: 18 },
        network: "testnet",
        networkId: 1337,
        rpc: [`http://localhost:8545`],
        supported: true,
        monitored: true,
    }),
    new SourcifyChain({
        name: "Hardhat Network Localhost",
        shortName: "Hardhat Network",
        chainId: 31337,
        faucets: [],
        infoURL: "localhost",
        nativeCurrency: { name: "localETH", symbol: "localETH", decimals: 18 },
        network: "testnet",
        networkId: 31337,
        rpc: [`http://localhost:8545`],
        supported: true,
        monitored: true,
    }),
];

interface SourcifyChainsExtensionsObject {
    [chainId: string]: SourcifyChainExtension;
}

/**
 *
 * @param chainName - "eth", "polygon" etc.
 * @param chainGroup "mainnet", "goerli"...
 * @param useOwn Use the local node
 * @returns
 */
function buildAlchemyAndCustomRpcURLs(
  chainSubName: string,
  chainName: ChainName,
  useOwn = false
) {
    const rpcURLs: SourcifyChain["rpc"] = [];

    if (useOwn) {
        const url = process.env[`NODE_URL_${chainSubName.toUpperCase()}`];
        if (url) {
            const ethersFetchReq = new FetchRequest(url);
            ethersFetchReq.setHeader("Content-Type", "application/json");
            ethersFetchReq.setHeader(
              "CF-Access-Client-Id",
              process.env.CF_ACCESS_CLIENT_ID || ""
            );
            ethersFetchReq.setHeader(
              "CF-Access-Client-Secret",
              process.env.CF_ACCESS_CLIENT_SECRET || ""
            );
            rpcURLs.push(ethersFetchReq);
        } else {
            SourcifyEventManager.trigger("Server.SourcifyChains.Warn", {
                message: `Environment variable NODE_URL_${chainSubName.toUpperCase()} not set!`,
            });
        }
    }

    let alchemyId;
    switch (chainName) {
        case "opt":
            alchemyId =
              process.env["ALCHEMY_ID_OPTIMISM"] || process.env["ALCHEMY_ID"];
            break;
        case "arb":
            alchemyId =
              process.env["ALCHEMY_ID_ARBITRUM"] || process.env["ALCHEMY_ID"];
            break;
        default:
            alchemyId = process.env["ALCHEMY_ID"];
            break;
    }

    if (!alchemyId) {
        SourcifyEventManager.trigger("Server.SourcifyChains.Warn", {
            message: `Environment variable ALCHEMY_ID not set for ${chainName} ${chainSubName}!`,
        });
    } else {
        const domain = "g.alchemy.com";
        rpcURLs.push(
          `https://${chainName}-${chainSubName}.${domain}/v2/${alchemyId}`
        );
    }

    return rpcURLs;
}
// replaces INFURA_API_KEY in https://networkname.infura.io/v3/{INFURA_API_KEY}
function replaceInfuraID(infuraURL: string) {
    return infuraURL.replace("{INFURA_API_KEY}", process.env.INFURA_ID || "");
}
function getBlockscoutRegex(blockscoutPrefix = "") {
    const tempBlockscoutOld = BLOCKSCOUT_REGEX_OLD.replace(
      "${BLOCKSCOUT_PREFIX}",
      blockscoutPrefix
    );
    return [tempBlockscoutOld, BLOCKSCOUT_REGEX_NEW];
}

// api?module=contract&action=getcontractcreation&contractaddresses=\${ADDRESS}&apikey=
// For chains with the new Etherscan api that has contract creator tx hash endpoint
function generateEtherscanCreatorTxAPI(chainId: string) {
    return (
      etherscanAPIs[chainId].apiURL +
      ETHERSCAN_API_SUFFIX +
      etherscanAPIs[chainId].apiKey
    );
}

const sourcifyChainsExtensions: SourcifyChainsExtensionsObject = {
    "16718": { // Ambrosus Mainnet
        "supported": true,
        "monitored": false,
    },
    "30746": { // Ambrosus Devnet
        "supported": true,
        "monitored": false,
    },
    "22040": { // Ambrosus Testnet
        "supported": true,
        "monitored": false,
    },
};

const sourcifyChainsMap: SourcifyChainMap = {};

// Add test chains too if developing or testing
if (process.env.NODE_ENV !== "production") {
    for (const chain of LOCAL_CHAINS) {
        sourcifyChainsMap[chain.chainId.toString()] = chain;
    }
}

// iterate over chainid.network's chains.json file and get the chains included in sourcify.
// Merge the chains.json object with the values from sourcify-chains.ts
// Must iterate over all chains because it's not a mapping but an array.
for (const i in allChains) {
    const chain = allChains[i];
    const chainId = chain.chainId;
    if (chainId in sourcifyChainsMap) {
        // Don't throw on local chains in development, override the chain.json item
        if (
          process.env.NODE_ENV !== "production" &&
          LOCAL_CHAINS.map((c) => c.chainId).includes(chainId)
        ) {
            continue;
        }
        const err = `Corrupt chains file (chains.json): multiple chains have the same chainId: ${chainId}`;
        throw new Error(err);
    }

    if (chainId in sourcifyChainsExtensions) {
        const sourcifyExtension = sourcifyChainsExtensions[chainId];
        // sourcifyExtension is spread later to overwrite chain values, rpc specifically
        const sourcifyChain = new SourcifyChain({
            ...chain,
            ...sourcifyExtension,
        });
        sourcifyChainsMap[chainId] = sourcifyChain;
    }
}

const sourcifyChainsArray = getSortedChainsArray(sourcifyChainsMap);
const supportedChainsArray = sourcifyChainsArray.filter(
  (chain) => chain.supported
);
// convert supportedChainArray to a map where the key is the chainId
const supportedChainsMap = supportedChainsArray.reduce(
  (map, chain) => ((map[chain.chainId.toString()] = chain), map),
  <SourcifyChainMap>{}
);
const monitoredChainArray = sourcifyChainsArray.filter(
  (chain) => chain.monitored
);
// convert monitoredChainArray to a map where the key is the chainId
const monitoredChainsMap = monitoredChainArray.reduce(
  (map, chain) => ((map[chain.chainId.toString()] = chain), map),
  <SourcifyChainMap>{}
);

// Gets the chainsMap, sorts the chains, returns Chain array.
export function getSortedChainsArray(
  chainMap: SourcifyChainMap
): SourcifyChain[] {
    function getPrimarySortKey(chain: any) {
        return chain.name || chain.title;
    }

    const chainsArray = Object.values(chainMap);
    // Have Ethereum chains on top.
    const ethereumChainIds = [1, 5, 11155111, 3, 4, 42];
    const ethereumChains = ethereumChainIds.map((id) => {
        // Use long form name for Ethereum netorks e.g. "Ethereum Testnet Goerli" instead of "Goerli"
        chainMap[id].name = chainMap[id].title || chainMap[id].name;
        return chainMap[id];
    });
    // Others, sorted alphabetically
    const otherChains = chainsArray
      .filter((chain) => ![1, 5, 11155111, 3, 4, 42].includes(chain.chainId))
      .sort((a, b) =>
        getPrimarySortKey(a) > getPrimarySortKey(b)
          ? 1
          : getPrimarySortKey(b) > getPrimarySortKey(a)
            ? -1
            : 0
      );

    const sortedChains = ethereumChains.concat(otherChains);
    return sortedChains;
}

/**
 * To check if a chain is supported for verification.
 * Note that there might be chains not supported for verification anymore but still exist as a SourcifyChain e.g. Ropsten.
 */
export function checkSupportedChainId(chainId: string) {
    if (!(chainId in sourcifyChainsMap && sourcifyChainsMap[chainId].supported)) {
        throw new ValidationError(
          `Chain ${chainId} not supported for verification!`
        );
    }

    return true;
}

/**
 * To check if a chain exists as a SourcifyChain.
 * Note that there might be chains not supported for verification anymore but still exist as a SourcifyChain e.g. Ropsten.
 */
export function checkSourcifyChainId(chainId: string) {
    if (
      !(chainId in sourcifyChainsMap && sourcifyChainsMap[chainId]) &&
      chainId != "0"
    ) {
        throw new Error(`Chain ${chainId} is not a Sourcify chain!`);
    }

    return true;
}

export {
    sourcifyChainsMap,
    sourcifyChainsArray,
    supportedChainsMap,
    supportedChainsArray,
    monitoredChainsMap,
    monitoredChainArray,
    LOCAL_CHAINS,
};
