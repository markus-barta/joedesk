# Plain installable source — version from package.json (must match JoeVersion.APP_VERSION).
{ pkgs ? import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/f5c082a40f7571c266e74e80ae2e68aadd8a9fc7.tar.gz";
    sha256 = "sha256-cRrWlIjVRJ6BHDr9caUdXsZ3owzWIKYHpNmGPHBInIU=";
  }) {} }:

let
  version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
in
pkgs.stdenv.mkDerivation {
  pname = "joedesk";
  inherit version;

  src = builtins.path {
    path = ./.;
    name = "joedesk-source";
    filter = path: type: !(builtins.elem (baseNameOf path) [ ".git" "node_modules" ".DS_Store" ]) &&
      !(pkgs.lib.hasPrefix ".env" (baseNameOf path));
  };

  nativeBuildInputs = [ pkgs.nodejs_22 ];

  buildPhase = ''
    runHook preBuild
    node scripts/check-release.mjs
    runHook postBuild
  '';

  installPhase = ''
    mkdir -p $out/share/joedesk/public
    cp -r $src/public/. $out/share/joedesk/public/
    cp -r $src/contracts $src/server $out/share/joedesk/
    cp -r $src/release $out/share/joedesk/
    install -m 644 $src/package.json $out/share/joedesk/
    install -m 644 $src/release.json $src/time.mjs $src/market-calendar.json $out/share/joedesk/

    mkdir -p $out/bin
    cat > $out/bin/joedesk-server <<EOF
#!/bin/sh
exec ${pkgs.nodejs_22}/bin/node $out/share/joedesk/server.mjs
EOF
    chmod +x $out/bin/joedesk-server

    install -m 644 $src/server.mjs $src/validate.mjs $src/fleet-config.mjs $out/share/joedesk/
  '';

  meta = {
    description = "Joe household paper-trading desk dashboard";
    mainProgram = "joedesk-server";
  };
}
