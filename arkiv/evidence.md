# On-chain evidence

Written by `packages/cli/scripts/publish-demo.ts` on 2026-10-18T06:04:08.497Z. Tiramisu, chain 7738577.
If the testnet is wiped, these transactions are the record; rerun the script to recreate the state.

| Step | Key | Entity | Transaction | Receipt |
|---|---|---|---|---|
| clean: release v1.4.2 | publisher | [0x60bd2b98…](https://tiramisu.explorer.arkiv.network/entity/0x60bd2b9879226f9cd00f80af04bf20c2376ba4f9bccfd9ff9237dfaeef15b526) | [0x83de8d66…](https://tiramisu.explorer.arkiv.network/tx/0x83de8d66a43e48089d68fafc26898f9f8b64290a44665ddd532dd935fee374e1) | 7230 ms |
| clean: approval of v1.4.2 | maintainer A | [0xe607eb74…](https://tiramisu.explorer.arkiv.network/entity/0xe607eb7485ff2df15a4c30a0996d73751044894d52547448fa15ecddfc78c098) | [0xafdef6de…](https://tiramisu.explorer.arkiv.network/tx/0xafdef6de5147f7750afc1b97862ca55ba8dfe808c8b78f3633ed132c8627f576) | 7132 ms |
| tampered: release v1.4.2 | publisher | [0x683b17a5…](https://tiramisu.explorer.arkiv.network/entity/0x683b17a5e43a83faff77324ef097cece6460117f895db81d083c20ca8ccf1453) | [0x62fd793c…](https://tiramisu.explorer.arkiv.network/tx/0x62fd793cc7c17dcddca3438db2b158ef8a5feb23bce42200d23d32954a56c043) | 6881 ms |
| tampered: approval of v1.4.2 | maintainer A | [0x2981f28f…](https://tiramisu.explorer.arkiv.network/entity/0x2981f28f937a4dc0903d82d76964f61008b55aacd7638acb2e6dfb2d5487f208) | [0x451bbd1c…](https://tiramisu.explorer.arkiv.network/tx/0x451bbd1ca2f94e3d3293971994eb42e1317e671b357246047b706431309103f2) | 6854 ms |
| forged: release v1.4.2 | publisher | [0x83c21bef…](https://tiramisu.explorer.arkiv.network/entity/0x83c21bef0738fb173f70e396de34431675c93d441987c1af8678b2ccdb75ed9a) | [0xd32ce2f7…](https://tiramisu.explorer.arkiv.network/tx/0xd32ce2f7a618fbd92719ab1e234baa6befb5db52e974489421c8f1f89b22646b) | 6834 ms |
| forged: approval of v1.4.2 | maintainer A | [0x9de56517…](https://tiramisu.explorer.arkiv.network/entity/0x9de5651707ce92de3617bd3ca1253c241d2ee41f1a871fc07b28b2c6975a86e1) | [0x28a38e14…](https://tiramisu.explorer.arkiv.network/tx/0x28a38e149a97b82569cd83a081209df9b9f89e13bd6c4dfb605f2a11de683ccb) | 6811 ms |
| forged: forged release, every field copied, seq 99 | forger | [0x800b83f2…](https://tiramisu.explorer.arkiv.network/entity/0x800b83f29123be6e4c79fa74fbfcda0454a74d48ebac5b33a31987b5a9350d9b) | [0x546c38b9…](https://tiramisu.explorer.arkiv.network/tx/0x546c38b91d00daf12c325b1c85167ad87ed6e8b46cf82487502c77d36ef00393) | 7145 ms |
| stolen-key: release v1.4.2 | publisher | [0x38432a0f…](https://tiramisu.explorer.arkiv.network/entity/0x38432a0fcb6b7633257a5bca8f97de11c78e9df4f80ad0f8aadcbce9f19364c8) | [0xae7eba37…](https://tiramisu.explorer.arkiv.network/tx/0xae7eba37b299246f88127d8c6b5cdbc8c925a2523d825cce3920e8297c6940b2) | 6909 ms |
| stolen-key: approval of v1.4.2 | maintainer A | [0xe27bcf45…](https://tiramisu.explorer.arkiv.network/entity/0xe27bcf45611de0e758dc5f9c5946ddd81aa95c828c0c185d069522e730de33fa) | [0xd49ad5ed…](https://tiramisu.explorer.arkiv.network/tx/0xd49ad5ed16de09d57b44080f916aff848e9de81d7565a92bb0916b9aa044fb8f) | 6866 ms |
| stolen-key: v1.4.3 from the CI key, nobody approves | publisher | [0x13651853…](https://tiramisu.explorer.arkiv.network/entity/0x1365185397058de4946ed4d01a8f8b996728f1d02c69705093bc39482d431307) | [0x3ea90bbc…](https://tiramisu.explorer.arkiv.network/tx/0x3ea90bbca6d0372abfeb6746753dc102fd8cbb9f086b42225ed2a62b4c9b1497) | 6864 ms |
| checkpoint (real production build): release v0.1.0 | publisher | [0xddc8e1cb…](https://tiramisu.explorer.arkiv.network/entity/0xddc8e1cbb8a69aa2a2835fced5c742b745c27894d72a8d135397a3b91c6d7503) | [0xa5061abf…](https://tiramisu.explorer.arkiv.network/tx/0xa5061abf324c48976318177a9c6091fd0c3a7fb9a86f332f5f4a4b7f4e29195c) | 6555 ms |
| checkpoint (real production build): approval of v0.1.0 | maintainer A | [0x34cb230b…](https://tiramisu.explorer.arkiv.network/entity/0x34cb230b956de402c50239a6755ea2027733cd0c395db58b28dca80fdc83658a) | [0xb15b1f72…](https://tiramisu.explorer.arkiv.network/tx/0xb15b1f7237043f7cec53a5394b8956e2d1ec0d3a6102c6edb13a7ca52770e821) | 6841 ms |
| replay: Safe's clean chunk, reconstructed | replay | [0x8895214b…](https://tiramisu.explorer.arkiv.network/entity/0x8895214b292b715928e147a3751c1d8720b0dc44ce635d428cceb39c28c754b9) | [0xd42e330b…](https://tiramisu.explorer.arkiv.network/tx/0xd42e330b86ce1dcb6f55772384ba61ddb359a78a93b91b0fdbbd8a61740d88d9) | 3245 ms |

## Live revocation, recorded for the demo film (Oct 18 ~06:50 UTC)

| Step | Key | Entity | Transaction |
|---|---|---|---|
| clean: revoke v1.4.2, reason compromised, burned in the same batch | maintainer B | [0xf11a9133…](https://tiramisu.explorer.arkiv.network/entity/0xf11a9133ce1e704a20a2ae58b090193b747a1f1ba74f320722eac7aa3ddc15ec) | [0x02a03d79…](https://tiramisu.explorer.arkiv.network/tx/0x02a03d795c4281ab9295806151b5c50a3e8205bfbfc2ea86f409b8ca88eebdf8) |
| clean: same bytes re-signed as v1.4.3 | publisher | [0x0b83c065…](https://tiramisu.explorer.arkiv.network/entity/0x0b83c065359a06c17de076819bb472583cbc71a682be6243e9779a21a7166e43) | |
| clean: approval of v1.4.3 | maintainer A | [0xcbcedddf…](https://tiramisu.explorer.arkiv.network/entity/0xcbcedddf0566bec1a1e3b097412d298e83cba553775963c1787c316da5af1b3d) | [0x200358b2…](https://tiramisu.explorer.arkiv.network/tx/0x200358b2b01ed20b51c34ec43d608f481e0e9c87a02fe8e37ed255f8f48b87bc) |

The open tab showed the block 6.3 s after the CLI started, which includes the CLI's own lookup before
it sends; the measured send-to-red time is in `proof/results/revocation-*.json` (median 3.9 s).
