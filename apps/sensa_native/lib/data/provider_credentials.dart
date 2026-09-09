import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Only opaque, application-owned IDs are accessed; never enumerate the user's keychain.
class ProviderCredentials {
  const ProviderCredentials();
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      resetOnError: false,
      storageNamespace: 'sensa_providers',
    ),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.unlocked_this_device,
    ),
    mOptions: MacOsOptions(
      usesDataProtectionKeychain: false,
      accessibility: KeychainAccessibility.unlocked_this_device,
    ),
  );
  Future<String?> read(String id) => _storage.read(key: 'sensa.provider.$id');
  Future<void> write(String id, String value) async {
    await _storage.write(key: 'sensa.provider.$id', value: value);
    if (await read(id) != value) {
      throw StateError('secure_storage_write_failed');
    }
  }

  Future<void> delete(String id) => _storage.delete(key: 'sensa.provider.$id');
}
