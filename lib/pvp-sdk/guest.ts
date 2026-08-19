// Vendored from @chain/pvp-sdk (src/guest.ts). Keep in sync with the registry.
import { WindowMessenger, connect } from 'penpal';
import type { Connection } from 'penpal';
import type { PvpGuestApiV1, PvpHostApiV1 } from './types';

export type {
  PvpGuestApiV1,
  PvpHostApiV1,
  PvpHostMetadataV1,
  PvpHostSnapshotV1,
  PvpLobbyMetadataV1,
  PvpMetadataBag,
  PvpMetadataPrimitive,
  PvpMetadataValue,
  PvpPlayerMetadataV1,
  PvpRoomMetadataV1,
  PvpRoomParticipantMetadataV1,
} from './types';

export type PvpGuestBridgeConnection = Connection<PvpHostApiV1>;

export type PvpContentSizeObserver = {
  disconnect(): void;
  report(): void;
};

const getAllowedParentOrigins = (): string[] => {
  if (typeof document === 'undefined' || !document.referrer) {
    return ['*'];
  }

  try {
    return [new URL(document.referrer).origin];
  } catch {
    return ['*'];
  }
};

export const connectGameToHost = (methods: PvpGuestApiV1): PvpGuestBridgeConnection =>
  connect<PvpHostApiV1>({
    messenger: new WindowMessenger({
      remoteWindow: window.parent,
      allowedOrigins: getAllowedParentOrigins(),
    }),
    methods,
  });

const getDocumentMinHeight = (): number => {
  const body = document.body;
  const documentElement = document.documentElement;

  return Math.ceil(
    Math.max(
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      documentElement.scrollHeight,
      documentElement.offsetHeight,
    ),
  );
};

export const reportGameContentSize = async (
  hostApi: Pick<PvpHostApiV1, 'reportContentSize'> | null | undefined,
): Promise<void> => {
  if (typeof document === 'undefined' || !hostApi?.reportContentSize) return;
  await hostApi.reportContentSize({ minHeight: getDocumentMinHeight() });
};

export const observeGameContentSize = (
  hostApi: Pick<PvpHostApiV1, 'reportContentSize'> | null | undefined,
): PvpContentSizeObserver => {
  let animationFrame = 0;

  const report = () => {
    if (typeof window === 'undefined') return;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(() => {
      void reportGameContentSize(hostApi).catch(() => {
        /* host may have navigated away */
      });
    });
  };

  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof ResizeObserver === 'undefined' ||
    !hostApi?.reportContentSize
  ) {
    return { disconnect() {}, report };
  }

  const observer = new ResizeObserver(report);
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);
  window.addEventListener('load', report);
  report();

  return {
    disconnect() {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('load', report);
      observer.disconnect();
    },
    report,
  };
};
