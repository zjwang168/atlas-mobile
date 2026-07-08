import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useRef } from 'react';
import {
    Animated,
    Dimensions,
    PanResponder,
    Pressable,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;

type ImportNotificationProps = {
  title: string;
  onPress: () => void;
  onSwipeDown?: () => void;
  onDismiss: () => void;
};

export default function ImportNotification({
  title,
  onPress,
  onSwipeDown,
  onDismiss,
}: ImportNotificationProps) {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // 弹出动画
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => {
        return gesture.dy > 10;
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 80) {
          onSwipeDown?.();
        }
      },
    }),
  ).current;

  const truncatedTitle = title.length > 60 ? title.slice(0, 57) + '...' : title;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 100,
        left: 16,
        right: 16,
        zIndex: 50,
        transform: [
          {
            translateY: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-80, 0],
            }),
          },
        ],
        opacity: opacityAnim,
      }}
      {...panResponder.panHandlers}
    >
      <Pressable
        onPress={onPress}
        className="overflow-hidden rounded-2xl bg-white shadow-lg"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <View className="flex-row items-center px-4 py-3">
          {/* 左侧图标 */}
          <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-blue-50">
            <Ionicons name="sparkles" size={16} color="#3B82F6" />
          </View>

          {/* 标题 */}
          <View className="flex-1">
            <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
              New import ready
            </Text>
            <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
              {truncatedTitle}
            </Text>
          </View>

          {/* 展开按钮 */}
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onPress();
            }}
            className="ml-2 h-8 w-8 items-center justify-center rounded-full bg-gray-100"
          >
            <Ionicons name="arrow-forward" size={16} color="#4B5563" />
          </TouchableOpacity>

          {/* 关闭按钮 */}
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="ml-1 h-8 w-8 items-center justify-center rounded-full bg-gray-100"
          >
            <Ionicons name="close" size={16} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
      </Pressable>
    </Animated.View>
  );
}
