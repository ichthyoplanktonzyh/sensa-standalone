import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// Only provider observations cross this bridge, never formal domain commands.
class YouglishView extends StatefulWidget {
  const YouglishView({
    super.key,
    required this.expression,
    required this.accent,
    required this.rate,
    required this.onEvent,
    required this.onController,
    this.fixtureScript,
  });
  final String expression, accent;
  final double rate;
  final void Function(Map<String, dynamic>) onEvent;
  final void Function(Future<void> Function(String)) onController;
  final String? fixtureScript;
  @override
  State<YouglishView> createState() => _YouglishViewState();
}

class _YouglishViewState extends State<YouglishView>
    with WidgetsBindingObserver, AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;
  InAppWebViewController? controller;
  Timer? timeout;
  bool disposed = false;
  void event(Map<String, dynamic> e) {
    if (disposed) return;
    if (e['status'] != 'loading') timeout?.cancel();
    widget.onEvent(e);
  }

  void deadline() {
    timeout?.cancel();
    timeout = Timer(
      const Duration(seconds: 15),
      () => event({'status': 'error', 'total': 0}),
    );
  }

  Future<void> call(String method) async {
    if (!['play', 'pause', 'replay', 'next', 'previous'].contains(method)) {
      return;
    }
    await evaluate('window.player?.$method();');
  }

  Future<void> evaluate(String source) async {
    try {
      await controller?.evaluateJavascript(source: source);
    } catch (_) {
      event({'status': 'error', 'total': 0});
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.onController(call);
    deadline();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) call('pause');
  }

  @override
  void didUpdateWidget(covariant YouglishView old) {
    super.didUpdateWidget(old);
    if (old.expression != widget.expression || old.accent != widget.accent) {
      deadline();
      evaluate(
        'window.search(${jsonEncode(widget.expression)},${jsonEncode(widget.accent)});',
      );
    }
    if (old.rate != widget.rate) {
      evaluate('window.player?.setSpeed(${widget.rate});');
    }
  }

  @override
  void dispose() {
    disposed = true;
    timeout?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    evaluate('window.player?.pause();window.player?.close();');
    super.dispose();
  }

  String inlineJson(String value) =>
      jsonEncode(value).replaceAll('<', r'\u003c');

  String html() {
    final script = widget.fixtureScript == null
        ? '<script src="https://youglish.com/public/emb/widget.js"></script>'
        : '<script>${widget.fixtureScript}</script>';
    return '''<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#202738}iframe{max-width:100%;border:0}</style><body><div id="player"></div><script>
 let total=0,caption=null,video=null,occurrence=null,playing=false,ready=false;
 const notify=(status)=>window.flutter_inappwebview?.callHandler('practiceEvent',{status,total,caption,video,occurrence,playing});
 window.search=(query,accent)=>{total=0;caption=null;video=null;occurrence=null;notify('loading');window.player?.fetch(query,'english',accent==='all'?undefined:accent);};
 function boot(){if(ready||!window.YG||!window.flutter_inappwebview)return;ready=true;
 window.player=new YG.Widget('player',{width:Math.round(innerWidth),components:'0',events:{
 onFetchDone:e=>{total=e.totalResult||0;notify(total?'ready':'empty');window.player.setSpeed(${widget.rate});},
 onCaptionChange:e=>{try{caption=decodeURIComponent(e.caption||'');}catch(_){caption=e.caption||'';}video=e.video||video;occurrence=e.trackNumber||occurrence;notify(total?'ready':'loading');},
 onVideoChange:e=>{video=e.video||null;occurrence=e.trackNumber||null;caption=null;notify(total?'ready':'loading');},
 onPlayerStateChange:e=>{playing=e.state===1;notify(total?'ready':'loading');},
 onError:()=>notify('error') }});
 window.search(${inlineJson(widget.expression)},${inlineJson(widget.accent)});}
 window.onYouglishAPIReady=boot;addEventListener('flutterInAppWebViewPlatformReady',boot);addEventListener('load',boot);
 </script>$script</body></html>''';
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return InAppWebView(
      initialData: InAppWebViewInitialData(
        data: html(),
        baseUrl: WebUri('https://app.sensa.local/'),
      ),
      initialSettings: InAppWebViewSettings(
        mediaPlaybackRequiresUserGesture: false,
        allowsInlineMediaPlayback: true,
        javaScriptEnabled: true,
        javaScriptCanOpenWindowsAutomatically: false,
        useShouldOverrideUrlLoading: true,
      ),
      onWebViewCreated: (c) {
        controller = c;
        c.addJavaScriptHandler(
          handlerName: 'practiceEvent',
          callback: (args) {
            if (args.isNotEmpty && args[0] is Map) {
              final e = Map<String, dynamic>.from(args[0] as Map);
              if ([
                'ready',
                'empty',
                'error',
                'loading',
              ].contains(e['status'])) {
                event(e);
              }
            }
            return null;
          },
        );
      },
      shouldOverrideUrlLoading: (c, action) async =>
          !action.isForMainFrame ||
              [
                'about:blank',
                'https://app.sensa.local/',
              ].contains(action.request.url.toString())
          ? NavigationActionPolicy.ALLOW
          : NavigationActionPolicy.CANCEL,
      onConsoleMessage: (c, message) {
        if (widget.fixtureScript != null) {
          debugPrint('practice fixture: ${message.message}');
        }
      },
      onLoadStop: (c, url) async {
        if (widget.fixtureScript != null) {
          debugPrint(
            'practice fixture loaded: ${await c.evaluateJavascript(source: "JSON.stringify({yg:!!window.YG,bridge:!!window.flutter_inappwebview,player:!!window.player})")}',
          );
        }
      },
      onReceivedError: (c, request, error) {
        if (request.isForMainFrame == true) {
          event({'status': 'error', 'total': 0});
        }
      },
    );
  }
}
