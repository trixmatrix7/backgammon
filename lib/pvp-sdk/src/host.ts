import { WindowMessenger, connect } from 'penpal';
import type { Connection } from 'penpal';
import type { PvpGuestApiV2, PvpHostApiV2 } from './types';

export type {
  PvpGuestApiV2,
  PvpHostApiV2,
  PvpHostMetadataV2,
  PvpHostSnapshotV2,
  PvpLobbyMetadataV2,
  PvpMetadataBag,
  PvpMetadataPrimitive,
  PvpMetadataValue,
  PvpPlayerMetadataV2,
  PvpRoomMetadataV2,
  PvpRoomParticipantMetadataV2,
} from './types';

export type PvpHostBridgeConnection = Connection<PvpGuestApiV2>;

export const connectHostToGame = (options: {
  iframe: HTMLIFrameElement;
  childOrigin: string;
  methods: PvpHostApiV2;
}): PvpHostBridgeConnection => {
  const remoteWindow = options.iframe.contentWindow;
  if (!remoteWindow) throw new Error('Iframe contentWindow is not available.');

  return connect<PvpGuestApiV2>({
    messenger: new WindowMessenger({
      remoteWindow,
      allowedOrigins: [options.childOrigin],
    }),
    methods: options.methods,
  });
};
