import { mineBlock } from "nexchain/miner/mining";

import { getAccount } from "account/balance/getAccount";
import { toNxc } from "nexchain/nexucoin/toNxc";

mineBlock("NxC41296362ed2b66dd3bd0a4c96b440ecf36973189")

getAccount('NxC41296362ed2b66dd3bd0a4c96b440ecf36973189').then(res => console.log(toNxc(res?.balance)))