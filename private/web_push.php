<?php
declare(strict_types=1);

// RFC 8291 uses a fresh encryption key per message, separate from the VAPID signing key.
function push_b64(string $value): string {
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function push_decode(string $value): string {
    return base64_decode(strtr($value, '-_', '+/'), true) ?: '';
}

function push_ec_key(): OpenSSLAsymmetricKey {
    $key = openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
    if (!$key) throw new RuntimeException('Could not generate Web Push key.');
    return $key;
}

function push_point(OpenSSLAsymmetricKey $key): string {
    $ec = openssl_pkey_get_details($key)['ec'];
    return "\x04".str_pad($ec['x'],32,"\0",STR_PAD_LEFT).str_pad($ec['y'],32,"\0",STR_PAD_LEFT);
}

function push_peer(string $point): OpenSSLAsymmetricKey|false {
    if (strlen($point) !== 65 || $point[0] !== "\x04") return false;
    // SubjectPublicKeyInfo for an uncompressed prime256v1 public key.
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$point;
    return openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der),64,"\n")."-----END PUBLIC KEY-----\n");
}

function push_encrypt(string $json, string $clientPoint, string $auth): string {
    $local = push_ec_key();
    $senderPoint = push_point($local);
    $peer = push_peer($clientPoint);
    $secret = $peer ? openssl_pkey_derive($peer,$local,32) : false;
    if (!$secret || strlen($auth)!==16 || strlen($json)>3993) throw new RuntimeException('Invalid push message.');
    $salt = random_bytes(16);
    $ikm = hash_hkdf('sha256',$secret,32,"WebPush: info\0".$clientPoint.$senderPoint,$auth);
    $key = hash_hkdf('sha256',$ikm,16,"Content-Encoding: aes128gcm\0",$salt);
    $nonce = hash_hkdf('sha256',$ikm,12,"Content-Encoding: nonce\0",$salt);
    $body = openssl_encrypt($json."\x02",'aes-128-gcm',$key,OPENSSL_RAW_DATA,$nonce,$tag);
    if ($body === false) throw new RuntimeException('Could not encrypt push message.');
    return $salt.pack('NC',4096,65).$senderPoint.$body.$tag;
}

function push_vapid(string $pem, string $audience, int $expiry): string {
    $header = push_b64('{"typ":"JWT","alg":"ES256"}');
    $claims = push_b64(json_encode(['aud'=>$audience,'exp'=>$expiry,'sub'=>'https://www.goeventdj.com/contact/'],JSON_THROW_ON_ERROR));
    $input = $header.'.'.$claims;
    if (!openssl_sign($input,$der,$pem,OPENSSL_ALGO_SHA256)) throw new RuntimeException('Could not sign push message.');
    // OpenSSL returns DER ECDSA integers. JWS requires the 32-byte unsigned R and S.
    $signature = '';
    $offset = 2;
    for ($i=0; $i<2; $i++) {
        $length = ord($der[$offset+1]);
        $value = ltrim(substr($der,$offset+2,$length),"\0");
        $signature .= str_pad($value,32,"\0",STR_PAD_LEFT);
        $offset += 2+$length;
    }
    return $input.'.'.push_b64($signature);
}
